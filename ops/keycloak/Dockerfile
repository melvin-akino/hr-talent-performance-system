# Keycloak splits configuration into build-time and run-time options. `start
# --optimized` skips the build step entirely, so build-time options set only as
# environment variables are silently ignored — Keycloak logs "values that differ
# from what is persisted" and crash-loops against the wrong (dev-file) database.
#
# The two build-time options this deployment needs are baked in here:
#   kc.db                 postgres, not the default dev-file store
#   kc.http-relative-path /auth, which the Caddyfile and OIDC_ISSUER_URL assume
#
# Everything else (hostname, credentials, DB URL) stays a run-time option and is
# supplied by compose.
FROM quay.io/keycloak/keycloak:26.0 AS build

ENV KC_DB=postgres
ENV KC_HTTP_RELATIVE_PATH=/auth
ENV KC_HEALTH_ENABLED=true
ENV KC_METRICS_ENABLED=true

RUN /opt/keycloak/bin/kc.sh build


FROM quay.io/keycloak/keycloak:26.0
COPY --from=build /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
