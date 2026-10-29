"""Per-analysis audit trail. Request bodies never contain credentials or headers."""
from __future__ import annotations
from contextvars import ContextVar
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import uuid

_active: ContextVar['Trace | None'] = ContextVar('zscore_trace', default=None)


class Trace:
    def __init__(self, trace_id: str | None = None):
        self.id = trace_id or str(uuid.uuid4())
        if not all(c.isalnum() or c in '-_' for c in self.id):
            raise ValueError('Invalid trace ID')
        self.directory = Path(os.environ.get('ZSCORE_TRACE_DIR', Path(__file__).parent / 'output' / 'traces')) / self.id
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.directory / 'events.jsonl'

    def event(self, stage: str, **data):
        record = {'time': datetime.now(timezone.utc).isoformat(), 'trace_id': self.id, 'stage': stage, **data}
        serialized=json.dumps(record, ensure_ascii=False, default=str)
        from .config import GLM_API_KEY
        for secret in [GLM_API_KEY,os.environ.get('ZSCORE_VISION_API_KEY'),os.environ.get('ZSCORE_AI_API_KEY')]:
            if secret:serialized=serialized.replace(secret,'[REDACTED]')
        with self.path.open('a', encoding='utf-8') as f:
            f.write(serialized + '\n')
        self.path.chmod(0o600)

    def __enter__(self):
        self.token = _active.set(self)
        return self

    def __exit__(self, typ, value, tb):
        if value:
            self.event('analysis.failed', error=type(value).__name__, message=str(value)[:400])
        _active.reset(self.token)


def event(stage: str, **data):
    trace = _active.get()
    if trace:
        trace.event(stage, **data)
