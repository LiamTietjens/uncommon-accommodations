import modal
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

app = modal.App("hospitable-webhook")
image = modal.Image.debian_slim().pip_install("fastapi")


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("trigger-dev-prod")],
)
@modal.fastapi_endpoint(method="POST")
def hospitable_webhook(data: dict):
    """Receive Hospitable message.created webhooks and forward to Trigger.dev."""
    import os

    print("=== HOSPITABLE WEBHOOK RECEIVED ===")
    print(json.dumps(data, indent=2, default=str))

    trigger_secret = os.environ["TRIGGER_SECRET_KEY"]
    trigger_url = "https://api.trigger.dev/api/v1/tasks/main-agent-workflow/trigger"

    # Filter out non-message events early
    action = data.get("action", "")
    if action and action != "message.created":
        print(f"Ignoring non-message event: {action}")
        return {"status": "ignored", "action": action}

    payload = json.dumps({
        "payload": {
            "event": data.get("action", data.get("event", "unknown")),
            "data": data,
            "received_at": datetime.now(timezone.utc).isoformat(),
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        trigger_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {trigger_secret}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
            print(f"Trigger.dev run created: {result}")
            return {"status": "ok", "trigger_run_id": result.get("id")}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"Trigger.dev error {e.code}: {error_body}")
        return {"status": "error", "detail": error_body}
