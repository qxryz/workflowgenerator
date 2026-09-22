import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bootstrap', Path(__file__).parents[1] / 'scripts/blender-service-bootstrap.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        addon = self.root / 'blender_mcp.py'
        addon.write_bytes(b'trusted fixture')
        permit = self.root / 'permit'; permit.write_text('nonce', encoding='utf-8')
        self.job = dict(nonce='nonce', permit=str(permit), expiresAt=time.time()*1000+10000,
                        processId=os.getpid(), port=9876, addonSha256=hashlib.sha256(addon.read_bytes()).hexdigest())
        self.enabled = False; self.starts = 0
        self.bpy = NS(app=NS(background=False, is_job_running=lambda _: False),
                      data=NS(filepath='original.blend', is_dirty=True, objects=[1, 2, 3]),
                      context=NS(scene=NS(name='Original', blendermcp_port=9876)),
                      utils=NS(user_resource=lambda *a, **kw: str(self.root)), types=NS())
        def start():
            self.starts += 1
            self.bpy.types.blendermcp_server = NS(running=True, port=9876)
        self.bpy.ops = NS(blendermcp=NS(start_server=start))
        def enable(*a, **kw):
            self.assertEqual(kw, dict(default_set=False, persistent=True))
            self.enabled = True
            return NS()
        self.addons = NS(check=lambda _: (False, self.enabled), modules=lambda **kw: None, enable=enable)

    def run_start(self):
        return bootstrap.start_service(self.job, self.bpy, self.addons)

    def test_starts_service_without_changing_project(self):
        r = self.run_start()
        self.assertTrue(r['ok']); self.assertEqual(r['projectBefore'], r['projectAfter'])
        self.assertEqual(self.starts, 1); self.assertTrue(self.enabled)
        self.assertFalse(r['hostControlVerified'])

    def test_expired_or_revoked_permit_cannot_enable(self):
        self.job['expiresAt'] = 0
        self.assertEqual(self.run_start()['code'], 'startup_expired')
        self.job['expiresAt'] = time.time()*1000+10000
        Path(self.job['permit']).unlink()
        self.assertEqual(self.run_start()['code'], 'startup_expired'); self.assertFalse(self.enabled)

    def test_wrong_instance_and_nonce_cannot_enable(self):
        self.job['processId'] += 1
        self.assertEqual(self.run_start()['code'], 'different_blender_instance')
        self.job['processId'] = os.getpid(); self.job['nonce'] = 'other'
        self.assertEqual(self.run_start()['code'], 'startup_expired'); self.assertFalse(self.enabled)

    def test_busy_application_cannot_enable(self):
        self.bpy.app.is_job_running = lambda _: True
        self.assertEqual(self.run_start()['code'], 'blender_busy'); self.assertFalse(self.enabled)

    def test_wrong_addon_hash_or_loaded_module_cannot_enable(self):
        expected = self.job['addonSha256']; self.job['addonSha256'] = '0'*64
        self.assertEqual(self.run_start()['code'], 'installed_addon_mismatch')
        self.job['addonSha256'] = expected
        with patch.dict('sys.modules', {'blender_mcp': NS(__file__=str(self.root/'other.py'))}):
            self.assertEqual(self.run_start()['code'], 'loaded_addon_mismatch')
        self.assertFalse(self.enabled)

    def test_existing_service_is_not_restarted(self):
        self.enabled = True; self.bpy.types.blendermcp_server = NS(running=True, port=9876)
        self.assertTrue(self.run_start()['ok']); self.assertEqual(self.starts, 0)

    def test_port_conflict_is_not_reconfigured(self):
        self.bpy.context.scene.blendermcp_port = 12345
        self.assertEqual(self.run_start()['code'], 'addon_port_mismatch'); self.assertFalse(self.enabled)

    def test_failed_enable_is_not_success(self):
        self.addons.enable = lambda *a, **kw: None
        self.assertEqual(self.run_start()['code'], 'addon_enable_failed'); self.assertEqual(self.starts, 0)


if __name__ == '__main__':
    unittest.main()
