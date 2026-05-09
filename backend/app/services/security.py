"""Auth: bcrypt password hashing + JWT tokens."""
import time
from passlib.context import CryptContext
from jose import jwt, JWTError

SECRET = "actigen-dev-secret-change-in-prod"
ALGO = "HS256"
TOKEN_TTL_HOURS = 24

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd_ctx.hash(plain)


def verify_password(plain: str, hashed: str | None) -> bool:
    if not hashed or not isinstance(hashed, str):
        return False
    try:
        return pwd_ctx.verify(plain, hashed)
    except Exception:
        return False


def make_token(username: str) -> str:
    """JWT with NumericDate exp/iat (avoids datetime serialization quirks across jose versions)."""
    now = int(time.time())
    payload = {"sub": username, "exp": now + TOKEN_TTL_HOURS * 3600, "iat": now}
    raw = jwt.encode(payload, SECRET, algorithm=ALGO)
    return raw.decode("ascii") if isinstance(raw, bytes) else str(raw)


def decode_token(token: str) -> str | None:
    try:
        data = jwt.decode(token, SECRET, algorithms=[ALGO])
        return data.get("sub")
    except JWTError:
        return None
