import logging

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional

from ..db import get_db
from ..models import User
from ..services.security import verify_password, make_token, decode_token, hash_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger(__name__)


class LoginIn(BaseModel):
    username: str
    password: str


class RegisterIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6, max_length=200)
    display_name: Optional[str] = Field(None, max_length=120)


class TokenOut(BaseModel):
    token: str
    username: str
    display_name: Optional[str] = None


class UserOut(BaseModel):
    username: str
    display_name: Optional[str] = None


def current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing token")
    token = authorization.split(" ", 1)[1]
    username = decode_token(token)
    if not username:
        raise HTTPException(401, "Invalid or expired token")
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(401, "User not found")
    return user


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    try:
        user = db.query(User).filter(User.username == body.username).first()
        if not user or not verify_password(body.password, user.password_hash):
            raise HTTPException(401, "Invalid credentials")
        token = make_token(str(user.username))
        return TokenOut(
            token=token,
            username=str(user.username),
            display_name=None if user.display_name is None else str(user.display_name),
        )
    except HTTPException:
        raise
    except Exception as e:
        log.exception("login failed for username=%r", getattr(body, "username", None))
        raise HTTPException(500, detail=f"Login failed: {e}") from e


@router.post("/register", response_model=TokenOut)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    try:
        if db.query(User).filter(User.username == body.username).first():
            raise HTTPException(409, "Username taken")
        user = User(
            username=body.username,
            password_hash=hash_password(body.password),
            display_name=body.display_name or body.username,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        token = make_token(str(user.username))
        return TokenOut(
            token=token,
            username=str(user.username),
            display_name=None if user.display_name is None else str(user.display_name),
        )
    except HTTPException:
        raise
    except Exception as e:
        log.exception("register failed for username=%r", getattr(body, "username", None))
        raise HTTPException(500, detail=f"Register failed: {e}") from e


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return UserOut(username=user.username, display_name=user.display_name)
