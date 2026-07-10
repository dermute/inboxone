"""Microsoft OAuth2 device-code flow for Outlook.com / Microsoft 365 accounts.

Uses MSAL's public-client device code flow so no redirect URI needs to be
reachable from Microsoft's servers - this works for a container with no
public HTTPS endpoint (localhost, LAN IP, behind a home network, etc).

Both the IMAP scope and the Graph Mail.Send scope are acquired from the same
underlying refresh token without a second user interaction.

DEFAULT_CLIENT_ID is Microsoft's own first-party "Office" public client ID -
the same well-known ID used by Thunderbird and several open-source IMAP/OAuth
tools to talk to Outlook.com without every deployment needing its own Azure
app registration. It's already consented for personal + work/school accounts
and legacy protocol (IMAP/SMTP) scopes, so users just see a normal Microsoft
sign-in + consent screen - no Azure Portal involved. Users can still supply
their own client_id (e.g. if Microsoft ever restricts this one, or an org
tenant blocks third-party first-party-ID reuse by policy).
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

import msal

DEFAULT_CLIENT_ID = "9e5f94bc-e8a4-4e73-b8be-63364c29d753"

IMAP_SCOPE = ["https://outlook.office.com/IMAP.AccessAsUser.All"]
GRAPH_SCOPE = ["https://graph.microsoft.com/Mail.Send"]

_AUTHORITY_TMPL = "https://login.microsoftonline.com/{tenant}"


@dataclass
class DeviceFlowState:
    flow: dict
    app: msal.PublicClientApplication
    status: str = "pending"  # pending | complete | error
    error: str | None = None
    token_cache_serialized: str | None = None
    username: str | None = None
    created_at: float = field(default_factory=time.time)


# In-memory registry of in-flight device code flows, keyed by our own id.
# Fine for a single-process, single-user app; flows are short-lived (minutes).
_flows: dict[str, DeviceFlowState] = {}


def _build_app(client_id: str, tenant: str, token_cache: msal.SerializableTokenCache | None = None):
    return msal.PublicClientApplication(
        client_id,
        authority=_AUTHORITY_TMPL.format(tenant=tenant),
        token_cache=token_cache,
    )


async def start_device_flow(client_id: str, tenant: str) -> dict:
    app = _build_app(client_id, tenant)
    flow = await asyncio.to_thread(app.initiate_device_flow, scopes=IMAP_SCOPE + GRAPH_SCOPE)
    if "user_code" not in flow:
        raise RuntimeError(f"Failed to start device flow: {flow.get('error_description', flow)}")

    flow_id = str(uuid.uuid4())
    state = DeviceFlowState(flow=flow, app=app)
    _flows[flow_id] = state

    asyncio.create_task(_drive_device_flow(flow_id))

    return {
        "flow_id": flow_id,
        "user_code": flow["user_code"],
        "verification_uri": flow["verification_uri"],
        "expires_in": flow.get("expires_in", 900),
    }


async def _drive_device_flow(flow_id: str) -> None:
    state = _flows[flow_id]
    try:
        result = await asyncio.to_thread(state.app.acquire_token_by_device_flow, state.flow)
        if "access_token" not in result:
            state.status = "error"
            state.error = result.get("error_description", "Unknown error acquiring token")
            return
        state.token_cache_serialized = state.app.token_cache.serialize()
        accounts = state.app.get_accounts()
        state.username = accounts[0]["username"] if accounts else None
        state.status = "complete"
    except Exception as exc:  # noqa: BLE001 - surfaced to the user via poll endpoint
        state.status = "error"
        state.error = str(exc)


def poll_device_flow(flow_id: str) -> dict:
    state = _flows.get(flow_id)
    if state is None:
        return {"status": "error", "error": "Unknown flow id"}
    result = {"status": state.status, "error": state.error}
    if state.status == "complete":
        result["token_cache"] = state.token_cache_serialized
        result["username"] = state.username
        del _flows[flow_id]
    elif state.status == "error":
        del _flows[flow_id]
    return result


def _load_app_with_cache(client_id: str, tenant: str, cache_json: str | None):
    cache = msal.SerializableTokenCache()
    if cache_json:
        cache.deserialize(cache_json)
    app = _build_app(client_id, tenant, token_cache=cache)
    return app, cache


def _accounts_or_none(app: msal.PublicClientApplication):
    accounts = app.get_accounts()
    return accounts[0] if accounts else None


async def get_access_token(
    *, client_id: str, tenant: str, cache_json: str | None, scope: list[str]
) -> tuple[str, str | None]:
    """Returns (access_token, new_cache_json_or_None_if_unchanged).

    `cache_json`/the returned cache are always plaintext MSAL token cache
    JSON - callers pass/store this via the ORM's EncryptedString column,
    which handles encryption at rest transparently, so this module never
    touches Fernet directly.
    """

    def _acquire():
        app, cache = _load_app_with_cache(client_id, tenant, cache_json)
        account = _accounts_or_none(app)
        if account is None:
            raise RuntimeError("No cached Microsoft account - account needs to be re-linked")
        result = app.acquire_token_silent(scope, account=account)
        if not result or "access_token" not in result:
            raise RuntimeError(
                f"Failed to refresh Microsoft token: {result.get('error_description') if result else 'no result'}"
            )
        new_cache = cache.serialize() if cache.has_state_changed else None
        return result["access_token"], new_cache

    return await asyncio.to_thread(_acquire)


async def get_imap_access_token(client_id: str, tenant: str, cache_json: str | None):
    return await get_access_token(
        client_id=client_id, tenant=tenant, cache_json=cache_json, scope=IMAP_SCOPE
    )


async def get_graph_access_token(client_id: str, tenant: str, cache_json: str | None):
    return await get_access_token(
        client_id=client_id, tenant=tenant, cache_json=cache_json, scope=GRAPH_SCOPE
    )
