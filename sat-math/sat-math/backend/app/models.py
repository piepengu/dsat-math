from __future__ import annotations

from sqlalchemy import Boolean, Column, Integer, String

from .db import Base


class Attempt(Base):
    __tablename__ = "attempts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=False)
    domain = Column(String, index=True, nullable=False)
    skill = Column(String, index=True, nullable=False)
    seed = Column(Integer, nullable=False)
    correct = Column(Boolean, nullable=False)
    correct_answer = Column(String, nullable=False)
