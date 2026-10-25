#!/bin/bash
# Gradle wrapper stub: downloads gradle if needed, then delegates.
# (A full wrapper jar is not included; CI installs Gradle directly.)
APP_HOME=$(cd "$(dirname "$0")/.." && pwd)
exec gradle "$@"
