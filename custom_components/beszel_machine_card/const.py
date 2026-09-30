"""Constants for the Home Assistant Beszel Agent Integration."""

from homeassistant.const import Platform

DOMAIN = "beszel_machine_card"
PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR]

CONF_URL = "url"
CONF_TOKEN = "token"
CONF_USERNAME = "username"
CONF_AUTH_METHOD = "auth_method"

AUTH_METHOD_PASSWORD = "password"

FALLBACK_POLL_INTERVAL = 5 * 60

CARD_URL = "/beszel_machine_card/beszel-machine-card.js"
TABLE_CARD_URL = "/beszel_machine_card/beszel-systems-table-card.js"
CARD_VERSION = "0.1.0"
