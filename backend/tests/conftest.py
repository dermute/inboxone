import os

from cryptography.fernet import Fernet

# Isolate tests from local configuration and real mail credentials.
os.environ["APP_PASSWORD"] = "test-password"
os.environ["SECRET_KEY"] = "test-session-key"
os.environ["ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
