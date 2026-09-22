# Phase 0: Import Book

## Workflow

1. Ask the user to provide a book file (supports .txt / .md / .pdf / .epub)
2. Read file contents:
   - `.txt` / `.md`: Read directly
   - `.pdf`: Use the `Read` tool (supports PDF reading)
   - `.epub`: Use `Bash` tool to run Python parsing (see below)
3. Save parsed plain text to `source/book.txt`
4. Confirm with the user that content was read correctly (show a preview of the first few hundred characters)

## State File

After import, write `.audiobook-state.json` using Python `json.dumps()`.

**`skillScriptsPath` must be the real absolute path** — not a placeholder. Derive it from the `available_skills` list visible in your system context:

- Find the `<location>` entry for the audiobook skill, e.g.:
  `file://<skills-dir>/audiobook/SKILL.md`
- Strip `file://` and `/SKILL.md`, then append `/scripts`:
  → `<skills-dir>/audiobook/scripts`

That string is your `skill_scripts_path`. Use it literally — do not guess or reconstruct from memory.

```python
import json, os, sys
from pathlib import Path

# Replace the string below with the path you derived above — do this BEFORE running the script.
# Example: "<skills-dir>/audiobook/scripts"
skill_scripts_path = "/FILL_IN_BEFORE_RUNNING/audiobook/scripts"

# Verify the path exists before continuing
if not Path(skill_scripts_path).is_dir():
    print(f"ERROR: skillScriptsPath does not exist: {skill_scripts_path}", file=sys.stderr)
    sys.exit(1)

# Locate the state file (project-relative, not skill-relative)
audiobook_root = Path(os.getcwd()) / ".audiobook"
book_dir = audiobook_root / "<book_name>"
book_dir.mkdir(parents=True, exist_ok=True)

state = {
    "currentStep": "parse",
    "bookName": "<book_name>",
    "sourceFile": "source/book.txt",
    "skillScriptsPath": skill_scripts_path,
    "totalChapters": 0,
    "characters": [],
    "voiceMapping": {
        "narrator": {"voiceId": None, "speed": 0.9},
        "characters": {}
    },
    "chaptersCompleted": [],
    "currentChapter": 0
}
(book_dir / ".audiobook-state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2))
print(f"State file written. skillScriptsPath={skill_scripts_path}")
```

**Before running**: replace `skill_scripts_path` with the actual value derived above. The `print` at the end confirms what was written.

## EPUB Parsing

```python
import zipfile
from html.parser import HTMLParser

class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.skip = False
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip = True
    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = False
        if tag in ('p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.text.append('\n')
    def handle_data(self, data):
        if not self.skip:
            self.text.append(data)
```
