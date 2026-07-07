from pydantic import BaseModel, Field


class MicrosoftOAuthStart(BaseModel):
    name: str
    color: str = Field(default="#0F6CBD", pattern=r"^#[0-9A-Fa-f]{6}$")
    client_id: str
    tenant: str = "common"


class MicrosoftOAuthStartResponse(BaseModel):
    flow_id: str
    user_code: str
    verification_uri: str
    expires_in: int


class MicrosoftOAuthPollResponse(BaseModel):
    status: str
    error: str | None = None
    account_id: int | None = None
