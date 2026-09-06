import json

from config import get_settings
from pipeline.readme_parser import detect_declared_python_version, parse_readme

SIMPLE_README = """
# Transcribe Tool

A small command line tool that transcribes an audio file to text.

## Usage

```
python app.py --input recording.mp3
```

Requires ffmpeg to be installed.
"""


class _FakeMessage:
    def __init__(self, content: str):
        self.content = content


class _FakeChoice:
    def __init__(self, content: str):
        self.message = _FakeMessage(content)


class _FakeCompletion:
    def __init__(self, content: str):
        self.choices = [_FakeChoice(content)]


class _FakeCompletions:
    def __init__(self, response_text: str):
        self._response_text = response_text
        self.last_kwargs: dict = {}

    def create(self, **kwargs):
        self.last_kwargs = kwargs
        return _FakeCompletion(self._response_text)


class _FakeChat:
    def __init__(self, response_text: str):
        self.completions = _FakeCompletions(response_text)


class _FakeOpenRouterClient:
    """Mimics the shape of openai.OpenAI enough for chat.completions.create."""

    def __init__(self, response_text: str):
        self.chat = _FakeChat(response_text)

    @property
    def last_payload(self) -> dict:
        return self.chat.completions.last_kwargs


def test_parse_readme_extracts_entry_point_from_a_real_simple_readme():
    fake_llm_output = json.dumps(
        {
            "entry_point": "app.py",
            "python_version": "3.10",
            "system_deps": ["ffmpeg"],
            "run_command": "python app.py",
            "description": "Transcribes an audio file to text.",
            "confidence": 0.87,
        }
    )
    client = _FakeOpenRouterClient(fake_llm_output)

    analysis = parse_readme(SIMPLE_README, client=client)

    assert analysis.entry_point == "app.py"
    assert analysis.python_version == "3.10"
    assert analysis.system_deps == ["ffmpeg"]
    assert analysis.run_command == "python app.py"
    assert analysis.confidence == 0.87
    assert client.last_payload["model"] == get_settings().openrouter_readme_model
    assert client.last_payload["extra_headers"] == {
        "HTTP-Referer": get_settings().openrouter_referer,
        "X-Title": get_settings().openrouter_title,
    }


def test_parse_readme_tolerates_prose_wrapped_around_the_json():
    wrapped = 'Sure, here is the analysis:\n{"entry_point": "app.py", "confidence": 0.7}\nHope that helps!'
    client = _FakeOpenRouterClient(wrapped)

    analysis = parse_readme(SIMPLE_README, client=client)

    assert analysis.entry_point == "app.py"
    assert analysis.confidence == 0.7


def test_parse_readme_falls_back_to_zero_confidence_on_unparseable_response():
    client = _FakeOpenRouterClient("this is not json at all")

    analysis = parse_readme(SIMPLE_README, client=client)

    assert analysis.confidence == 0.0
    assert analysis.entry_point is None


def test_detect_declared_python_version_reads_pyproject_requires_python(tmp_path):
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "yt-dlp"\nrequires-python = ">=3.10"\n'
    )

    assert detect_declared_python_version(tmp_path) == "3.10"


def test_detect_declared_python_version_reads_setup_cfg_python_requires(tmp_path):
    (tmp_path / "setup.cfg").write_text("[options]\npython_requires = >=3.8\n")

    assert detect_declared_python_version(tmp_path) == "3.8"


def test_detect_declared_python_version_returns_none_when_undeclared(tmp_path):
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "some-tool"\n')

    assert detect_declared_python_version(tmp_path) is None
