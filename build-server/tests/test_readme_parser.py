import json

from config import get_settings
from pipeline.readme_parser import parse_readme

SIMPLE_README = """
# Transcribe Tool

A small command line tool that transcribes an audio file to text.

## Usage

```
python app.py --input recording.mp3
```

Requires ffmpeg to be installed.
"""


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _FakeOllamaClient:
    def __init__(self, response_text: str):
        self._response_text = response_text
        self.last_payload = None

    def post(self, url, json=None):
        self.last_payload = json
        return _FakeResponse({"response": self._response_text})

    def close(self):
        pass


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
    client = _FakeOllamaClient(fake_llm_output)

    analysis = parse_readme(SIMPLE_README, client=client)

    assert analysis.entry_point == "app.py"
    assert analysis.python_version == "3.10"
    assert analysis.system_deps == ["ffmpeg"]
    assert analysis.run_command == "python app.py"
    assert analysis.confidence == 0.87
    assert client.last_payload["model"] == get_settings().ollama_readme_model


def test_parse_readme_tolerates_prose_wrapped_around_the_json():
    wrapped = 'Sure, here is the analysis:\n{"entry_point": "app.py", "confidence": 0.7}\nHope that helps!'
    client = _FakeOllamaClient(wrapped)

    analysis = parse_readme(SIMPLE_README, client=client)

    assert analysis.entry_point == "app.py"
    assert analysis.confidence == 0.7


def test_parse_readme_falls_back_to_zero_confidence_on_unparseable_response():
    client = _FakeOllamaClient("this is not json at all")

    analysis = parse_readme(SIMPLE_README, client=client)

    assert analysis.confidence == 0.0
    assert analysis.entry_point is None
