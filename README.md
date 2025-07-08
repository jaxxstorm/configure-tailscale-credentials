# Configure Tailscale Credentials Action

A GitHub Action that uses GitHub's OIDC to authenticate with Tailscale and create OAuth clients for CI/CD workflows. This eliminates the need to store long-lived secrets in your repository.

## ✨ Features

- 🔐 **Zero stored secrets** - Uses GitHub OIDC for authentication
- ⏱️ **Ephemeral credentials** - OAuth clients automatically expire
- 🏷️ **Tag support** - Apply custom tags to devices
- 🔄 **Automatic cleanup** - No manual credential management
- 🛡️ **Secure by design** - All credentials marked as secrets

## 🚀 Quick Start

### 1. Create Tailscale OIDC Configuration

1. Go to your [Tailscale Admin Console](https://login.tailscale.com/admin/settings/oauth)
2. Click **Generate OAuth Client**
3. Select "Enabled Federated Authentication using OIDC"
4. Configure the OIDC settings:

```
OIDC Issuer: https://token.actions.githubusercontent.com
OIDC Subject: repo:your-org/your-repo:*
```

**Important**: Update the subject pattern to match your organization/repository:
- For specific repo: `repo:your-org/your-repo:*`
- For all repos: `repo:your-org/*`

5. Ensure you have the correct scopes, generally these are:

- `devices:core`
- `auth_keys`
- `oauth_keys`

6. Set appropriate tags for device access (e.g., `tag:ci`)

After creating the OIDC configuration, note down these values:
- **OIDC Workload ID**: `TdWjeTt8mN11CNTRL/kk2ZtKKNGK11CNTRL`
- **OIDC Audience**: `api.tailscale.com/kk2ZtKKNGK11CNTRL`

### 2. Use in Your Workflow

```yaml
name: Deploy with Tailscale

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # Required for OIDC
      contents: read
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure Tailscale Credentials
        id: tailscale-auth
        uses: jaxxstorm/configure-tailscale-credentials@v1
        with:
          audience: 'api.tailscale.com/kk2ZtKKNGK11CNTRL'
          client-id: 'TdWjeTt8mN11CNTRL/kk2ZtKKNGK11CNTRL'
          tailnet: 'your-tailnet'
          tags: 'tag:ci'

      - name: Connect to Tailscale
        uses: tailscale/github-action@v2
        with:
          oauth-client-id: ${{ steps.tailscale-auth.outputs.ts-oauth-client-id }}
          oauth-secret: ${{ steps.tailscale-auth.outputs.ts-oauth-client-secret }}
          tags: 'tag:ci'

      - name: Access private resources
        run: |
          # Now you can access private resources on your Tailscale network
          curl https://internal-api.your-tailnet.ts.net/health
          ssh user@private-server.your-tailnet.ts.net "deploy.sh"
```

## 📋 Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `audience` | Tailscale OIDC audience (format: `api.tailscale.com/YOUR_TAILNET_ID`) | ✅ | - |
| `client-id` | Tailscale OIDC client ID (format: `WORKLOAD_ID/TAILNET_ID`) | ✅ | - |
| `tailnet` | Tailnet name | ❌ | `-` |
| `tags` | Comma-separated tags for devices (include `tag:` prefix) | ❌ | - |

## 📤 Outputs

| Output | Description |
|--------|-------------|
| `ts-access-token` | Tailscale API access token |
| `ts-oauth-client-id` | Generated OAuth client ID |
| `ts-oauth-client-secret` | Generated OAuth client secret |

## 🔧 Configuration

### Finding Your Values

After creating your OIDC configuration in Tailscale, you'll get:

1. **Audience**: `api.tailscale.com/YOUR_TAILNET_ID`
   - Example: `api.tailscale.com/kk2ZtKKNGK11CNTRL`

2. **Client ID**: `WORKLOAD_ID/TAILNET_ID`
   - Example: `TdWjeTt8mN11CNTRL/kk2ZtKKNGK11CNTRL`

3. **Subject Pattern**: `repo:OWNER/REPO:*`
   - For specific repo: `repo:jaxxstorm/my-repo:*`
   - For all repos in org: `repo:jaxxstorm/*`

### Required Scopes

Ensure your OIDC configuration includes these scopes:
- `devices:core` - Required for device management
- `auth_keys` - Required for authentication key operations
- `oauth_keys` - Required for OAuth client creation

### Using Repository Variables

For cleaner workflows, store values as repository variables:

**Settings → Secrets and variables → Actions → Variables**

```
TAILSCALE_AUDIENCE=api.tailscale.com/kk2ZtKKNGK11CNTRL
TAILSCALE_CLIENT_ID=TdWjeTt8mN11CNTRL/kk2ZtKKNGK11CNTRL
TAILSCALE_TAILNET=your-tailnet
```

Then use in your workflow:

```yaml
- name: Configure Tailscale Credentials
  uses: jaxxstorm/configure-tailscale-credentials@v1
  with:
    audience: ${{ vars.TAILSCALE_AUDIENCE }}
    client-id: ${{ vars.TAILSCALE_CLIENT_ID }}
    tailnet: ${{ vars.TAILSCALE_TAILNET }}
    tags: 'tag:ci'
```

## 🔄 Multiple Environments

Use different configurations per environment:

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [development, staging, production]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    permissions:
      id-token: write
      contents: read
    
    steps:
      - name: Configure Tailscale
        uses: jaxxstorm/configure-tailscale-credentials@v1
        with:
          audience: ${{ vars.TAILSCALE_AUDIENCE }}
          client-id: ${{ vars.TAILSCALE_CLIENT_ID }}
          tailnet: ${{ vars.TAILSCALE_TAILNET }}
          tags: 'tag:${{ vars.ENVIRONMENT }}'
```

## 🛡️ Security Best Practices

1. **Use specific subject patterns** - Don't use overly broad wildcards
2. **Apply appropriate tags** - Limit device permissions with tags (include `tag:` prefix)
3. **Enable ephemeral devices** - Devices auto-cleanup after use
4. **Monitor access** - Review Tailscale audit logs regularly
5. **Rotate OIDC configs** - Periodically update OIDC configurations
6. **Limit scopes** - Only grant necessary scopes (`devices:core`, `auth_keys`, `oauth_keys`)

## 🔍 Troubleshooting

### Common Issues

**403 Unauthorized**
- Verify OIDC issuer is exactly: `https://token.actions.githubusercontent.com` (no 's')
- Check subject pattern matches your repository
- Ensure audience format is correct
- Verify required scopes are enabled

**Missing id-token permission**
```yaml
permissions:
  id-token: write  # This is required!
  contents: read
```

**Subject mismatch**
- For repository `jaxxstorm/my-app`, use subject: `repo:jaxxstorm/my-app:*`
- For all repositories, use: `repo:jaxxstorm/*`

**Missing scopes**
Ensure your OIDC configuration includes:
- `devices:core`
- `auth_keys` 
- `oauth_keys`

**Tag format**
Remember to include the `tag:` prefix:
- ✅ `tag:ci`
- ❌ `ci`

### Debug Mode

Enable debug logging by setting the `ACTIONS_STEP_DEBUG` secret to `true` in your repository.

## 📚 How It Works

1. **GitHub OIDC**: Action requests JWT token with custom Tailscale audience
2. **Token Exchange**: JWT is exchanged for Tailscale API access token using undocumented OIDC flow
3. **OAuth Client Creation**: Creates ephemeral OAuth client for device connection
4. **Tailscale Connection**: Use generated credentials with official Tailscale action

## 🤝 Contributing

Contributions welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Related Projects

- [tailscale/github-action](https://github.com/tailscale/github-action) - Official Tailscale GitHub Action
- [Tailscale OIDC Documentation](https://tailscale.com/kb/1240/sso-oidc/) - Official OIDC setup guide

## 📤 Outputs

| Output | Description |
|--------|-------------|
| `ts-access-token` | Tailscale API access token |
| `ts-oauth-client-id` | Generated OAuth client ID |
| `ts-oauth-client-secret` | Generated OAuth client secret |

## 🔧 Configuration

### Finding Your Values

1. **Audience**: `api.tailscale.com/YOUR_TAILNET_ID`
   - Found in your Tailscale admin console
   - Example: `api.tailscale.com/kk2ZtKKNGK11CNTRL`

2. **Client ID**: `WORKLOAD_ID/TAILNET_ID`
   - Found in your OIDC configuration
   - Example: `TdWjeTt8mN11CNTRL/kk2ZtKKNGK11CNTRL`

3. **Subject Pattern**: `repo:OWNER/REPO:*`
   - For specific repo: `repo:your-org/my-repo:*`
   - For all repos in org: `repo:your-org/*`

### Using Repository Variables

For cleaner workflows, store values as repository variables:

**Settings → Secrets and variables → Actions → Variables**

```
TAILSCALE_AUDIENCE=api.tailscale.com/kk2ZtKKNGK11CNTRL
TAILSCALE_CLIENT_ID=TdWjeTt8mN11CNTRL/kk2ZtKKNGK11CNTRL
TAILSCALE_TAILNET=your-tailnet
```

Then use in your workflow:

```yaml
- name: Configure Tailscale Credentials
  uses: jaxxstorm/configure-tailscale-credentials@v1
  with:
    audience: ${{ vars.TAILSCALE_AUDIENCE }}
    client-id: ${{ vars.TAILSCALE_CLIENT_ID }}
    tailnet: ${{ vars.TAILSCALE_TAILNET }}
    tags: 'ci'
```

## 🔄 Multiple Environments

Use different configurations per environment:

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [development, staging, production]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    permissions:
      id-token: write
      contents: read
    
    steps:
      - name: Configure Tailscale
        uses: jaxxstorm/configure-tailscale-credentials@v1
        with:
          audience: ${{ vars.TAILSCALE_AUDIENCE }}
          client-id: ${{ vars.TAILSCALE_CLIENT_ID }}
          tailnet: ${{ vars.TAILSCALE_TAILNET }}
          tags: ${{ vars.ENVIRONMENT }}
```

## 🛡️ Security Best Practices

1. **Use specific subject patterns** - Don't use overly broad wildcards
2. **Apply appropriate tags** - Limit device permissions with tags
3. **Enable ephemeral devices** - Devices auto-cleanup after use
4. **Monitor access** - Review Tailscale audit logs regularly
5. **Rotate OIDC configs** - Periodically update OIDC configurations

## 🔍 Troubleshooting

### Common Issues

**403 Unauthorized**
- Verify OIDC issuer is exactly: `https://token.actions.githubusercontent.com` - must match exactly!
- Check subject pattern matches your repository
- Ensure audience format is correct

**Missing id-token permission**
```yaml
permissions:
  id-token: write  # This is required!
  contents: read
```

**Subject mismatch**
- For repository `jaxxstorm/my-app`, use subject: `repo:jaxxstorm/my-app:*`
- For all repositories, use: `repo:jaxxstorm/*`

### Debug Mode

Enable debug logging by setting the `ACTIONS_STEP_DEBUG` secret to `true` in your repository.

## 📚 How It Works

1. **GitHub OIDC**: Action requests JWT token with custom Tailscale audience
2. **Token Exchange**: JWT is exchanged for Tailscale API access token
3. **OAuth Client Creation**: Creates ephemeral OAuth client for device connection
4. **Tailscale Connection**: Use generated credentials with official Tailscale action

## 🤝 Contributing

Contributions welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Related Projects

- [tailscale/github-action](https://github.com/tailscale/github-action) - Official Tailscale GitHub Action
