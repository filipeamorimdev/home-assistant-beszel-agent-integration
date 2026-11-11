"""Constants for the Beszel Agent Integration."""

from homeassistant.const import Platform

DOMAIN = "beszel_machine_card"
PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR, Platform.UPDATE]

CONF_URL = "url"
CONF_TOKEN = "token"
CONF_USERNAME = "username"
CONF_AUTH_METHOD = "auth_method"

AUTH_METHOD_PASSWORD = "password"

FALLBACK_POLL_INTERVAL = 5 * 60
# Containers, services and monitors never produce realtime events.
EXTRAS_POLL_INTERVAL = 60
# The Hub caches its GitHub release check for 6 h; its version rarely changes.
HUB_INFO_POLL_INTERVAL = 60 * 60
# After a failed read, try again sooner than the next hourly poll.
HUB_INFO_RETRY_INTERVAL = 5 * 60

CARD_URL = "/beszel_machine_card/beszel-machine-card.js"
TABLE_CARD_URL = "/beszel_machine_card/beszel-systems-table-card.js"
CARD_VERSION = "0.1.3"
