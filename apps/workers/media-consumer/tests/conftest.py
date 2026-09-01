import os
import sys
from pathlib import Path

# Set before media_consumer.config is imported anywhere — it reads the
# environment at import time, so a missing value is an ImportError rather than
# a late failure in a running function.
os.environ.setdefault("ASSETS_BUCKET", "nahuat-assets-test")
os.environ.setdefault("DB_SECRET_ARN", "arn:aws:secretsmanager:us-east-1:1:secret:test")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "nahuat_test")
os.environ.setdefault("MEDIA_CONTRACTS_DIR", str(Path(__file__).resolve().parents[1] / "contracts"))

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
