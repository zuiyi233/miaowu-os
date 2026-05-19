import tomllib, pathlib
p = pathlib.Path(r"D:/miaowu-os/deer-flow-main/backend/uv.lock")
try:
    tomllib.loads(p.read_text(encoding='utf-8'))
    print('UV_LOCK_TOML_OK')
except Exception as e:
    print('UV_LOCK_TOML_ERROR', e)
