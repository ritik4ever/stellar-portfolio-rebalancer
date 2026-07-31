# Alertmanager on-call secrets

This directory is mounted read-only into the Alertmanager container at
`/etc/alertmanager/secrets`. Alertmanager reads the paging credential from a file
rather than an inline config value, so the key never enters version control.

Create exactly one file, matching the vendor the `severity: critical` route in
`../alertmanager.yml` points at:

| Vendor    | File name               | Contents                                            |
| --------- | ----------------------- | --------------------------------------------------- |
| PagerDuty | `pagerduty_routing_key` | The Events API v2 integration key for the service   |
| Opsgenie  | `opsgenie_api_key`      | The API key of an Opsgenie API integration          |

```bash
printf '%s' "$PAGERDUTY_ROUTING_KEY" > pagerduty_routing_key
chmod 600 pagerduty_routing_key
```

Using `printf` rather than `echo` avoids a trailing newline. Do not commit the
resulting file — the `.gitignore` in this directory already excludes both key
names.

The directory is named `oncall-secrets` rather than `secrets` because the
repository root `.gitignore` excludes every `secrets/` directory, which would
have hidden this README from review as well.

Until a key file exists, critical alerts will fail to deliver and Alertmanager
will log a notification error. Local development that does not need paging can
point the critical route at the `default` webhook receiver instead.
