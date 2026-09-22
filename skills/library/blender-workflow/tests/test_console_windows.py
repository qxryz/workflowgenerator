import importlib.util
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace as NS
import unittest

spec = importlib.util.spec_from_file_location('console_dispatch', Path(__file__).parents[1] / 'scripts/blender-console-windows.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class ConsoleTest(unittest.TestCase):
    def dispatch_fixture(self, folder, windows, launched=True):
        p = Path(folder) / 'job.json'; permit = Path(folder) / 'permit'
        permit.write_text('n')
        p.write_text(json.dumps(dict(expiresAt=time.time()*1000+20000,
            permit=str(permit), nonce='n', launched=launched)))
        calls = []
        controller = NS(windows=windows, activate=lambda _: calls.append('activate'),
            chord=lambda _, keys: calls.append(keys), text=lambda _, value: calls.append(value))
        return p, controller, calls

    def test_cold_start_waits_for_window_and_dismisses_welcome_before_console(self):
        with tempfile.TemporaryDirectory() as folder:
            window = dict(owner=0, pid=123, **{'class': 'GHOST_WindowClass'})
            observed = iter([[], [], [window]])
            p, controller, calls = self.dispatch_fixture(folder, lambda _: next(observed))
            result = module.dispatch('app', 'command', p, controller, sleep=lambda _: None)
            self.assertEqual(result['code'], 'console_dispatched')
            self.assertEqual(calls, ['activate', [0x1B], [0x10, 0x73], [0x11, 0x41], 'command', [0x0D]])
            self.assertEqual(json.loads(p.read_text())['processId'], 123)

    def test_missing_cold_window_has_bounded_wait_and_no_input(self):
        with tempfile.TemporaryDirectory() as folder:
            p, controller, calls = self.dispatch_fixture(folder, lambda _: [])
            waits = []
            result = module.dispatch('app', 'command', p, controller, sleep=waits.append)
            self.assertEqual(result['code'], 'blender_window_not_ready')
            self.assertEqual(sum(waits), 8)
            self.assertEqual(calls, [])

    def test_additional_window_after_cold_start_still_blocks_all_input(self):
        with tempfile.TemporaryDirectory() as folder:
            observed = iter([[], [{}, {}]])
            p, controller, calls = self.dispatch_fixture(folder, lambda _: next(observed))
            result = module.dispatch('app', 'command', p, controller, sleep=lambda _: None)
            self.assertEqual(result['code'], 'blender_window_ambiguous')
            self.assertEqual(calls, [])

    def test_existing_instance_does_not_receive_welcome_dismissal(self):
        with tempfile.TemporaryDirectory() as folder:
            window = dict(owner=0, pid=123, **{'class': 'GHOST_WindowClass'})
            p, controller, calls = self.dispatch_fixture(folder, lambda _: [window], launched=False)
            result = module.dispatch('app', 'command', p, controller, sleep=lambda _: None)
            self.assertEqual(result['code'], 'console_dispatched')
            self.assertNotIn([0x1B], calls)

    def test_shortcuts_use_nonzero_hardware_scan_codes(self):
        controller = object.__new__(module.WindowsConsole)
        controller.user = NS(MapVirtualKeyW=lambda key, _: {16: 42, 115: 62}[key])
        events = []
        controller.send = lambda window, batch: events.extend((e.value.ki.wVk, e.value.ki.wScan, e.value.ki.dwFlags) for e in batch)
        controller.chord({}, [16, 115])
        self.assertEqual(events, [(0, 42, 8), (0, 62, 8), (0, 62, 10), (0, 42, 10)])

    def test_console_text_uses_layout_mapped_keys_not_unicode_packets(self):
        controller = object.__new__(module.WindowsConsole)
        controller.user = NS(VkKeyScanW=lambda ch: {'a': 65, 'A': 65 | 256, '(': 57 | 256}[ch])
        chords = []; controller.chord = lambda window, keys: chords.append(keys)
        controller.text({}, 'aA(')
        self.assertEqual(chords, [[65], [16, 65], [16, 57]])
        with self.assertRaises(RuntimeError): controller.text({}, 'a\n')

    def test_ambiguous_windows_never_receive_input(self):
        result = module.dispatch('app', 'command', 'absent.json', NS(windows=lambda _: [{}, {}]))
        self.assertEqual(result['code'], 'blender_window_ambiguous')

    def test_revoked_job_never_activates_window(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / 'job.json'
            p.write_text(json.dumps(dict(expiresAt=time.time()*1000+10000, permit=str(Path(folder)/'absent'), nonce='n')))
            controller = NS(windows=lambda _: [dict(owner=0, **{'class': 'GHOST_WindowClass'})])
            result = module.dispatch('app', 'command', p, controller)
            self.assertEqual(result['code'], 'startup_expired')


if __name__ == '__main__': unittest.main()
