from os import environ

# API key is read from the environment so no secret is committed to the repo.
# The web app's Settings panel can also supply a per-request key that overrides
# this; the CLI accepts --api-key. Set VENAFI_API_KEY to use the bridge/CLI
# defaults.
API_KEY = environ.get("VENAFI_API_KEY", "")
CA_URL = "https://api.venafi.cloud"
APP_ID = "f73a4ae0-00e8-11ef-97f7-895b798822ed"
DC_CIT_ID = "63fe1510-16bd-11ee-a34d-71154b171c96"
INT_CIT_ID = "849a9d80-6140-11ed-8f83-bd9f7d1328d6"
APP_NAME = "SSEAdmin"
