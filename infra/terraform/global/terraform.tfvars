# Immutable OIDC subject prefix - see variables.tf for why it is not owner/repo.
github_subject = "repo:vrtobar@4165944/nawat-app@1338730253"

# TEMPORARY - the repository being migrated away from, authorized alongside the
# one above so neither is ever unable to deploy. Set to "" and re-apply once
# nawat-app has completed a deploy.
github_subject_previous = "repo:vrtobar@4165944/nahuat-platform@1330083450"
