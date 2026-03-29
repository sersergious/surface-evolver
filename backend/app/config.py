from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    se_lib_path: str = "/app/libse.so"
    se_fe_dir: str = "/app/fe"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
