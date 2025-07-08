import * as core from '@actions/core'
import * as http from '@actions/http-client'

interface TokenExchangeResponse {
    access_token: string
    token_type: string
    expires_in?: number
    scope?: string
}

interface AuthKeyResponse {
    key: string
    id: string
    created: string
    expires: string
    capabilities: {
        devices: {
            create: {
                ephemeral: boolean
                preauthorized: boolean
                reusable: boolean
                tags?: string[]
            }
        }
    }
}

interface OAuthClientResponse {
    id: string
    key: string
    keyType: string
    expirySeconds: number
    created: string
    expires: string
    capabilities: {
        devices: {
            create: {
                reusable: boolean
                ephemeral: boolean
                preauthorized: boolean
                tags?: string[]
            }
        }
    }
    scopes: string[]
    tags?: string[]
    description: string
    invalid: boolean
    userId: string
}

interface ErrorResponse {
    error: string
    error_description?: string
    message?: string
}

async function run(): Promise<void> {
    try {
        // Get inputs
        const clientId = core.getInput('client-id', { required: true })
        const audience = core.getInput('audience', { required: true })
        const tailnet = core.getInput('tailnet') || '-'
        const tags = core.getInput('tags')

        core.info('Starting Tailscale OAuth authentication flow...')

        // 1) Request JWT from GitHub with custom audience
        core.info(`Requesting GitHub ID token with audience: ${audience}`)
        const jwt = await core.getIDToken(audience)
        
        if (!jwt) {
            throw new Error('Failed to obtain GitHub ID token. Ensure id-token: write permission is set.')
        }

        // Log JWT info for debugging (first 50 chars only)
        core.info(`✅ JWT obtained: ${jwt.substring(0, 50)}...`)
        core.info(`JWT length: ${jwt.length} characters`)

        // 2) Exchange JWT for Tailscale API token
        core.info('Exchanging GitHub ID token for Tailscale access token...')
        const accessToken = await exchangeTokenForTailscaleToken(clientId, jwt)

        // Mark token as secret and export
        core.setSecret(accessToken)
        core.exportVariable('TS_ACCESS_TOKEN', accessToken)
        core.setOutput('ts-access-token', accessToken)
        
        // Output partial token for debugging (first 10 chars only)
        core.info(`✅ Access token created: ${accessToken.substring(0, 10)}...`)

        // 3) Create OAuth client
        core.info('Creating Tailscale OAuth client...')
        const oauthClient = await createTailscaleOAuthClient(accessToken, tailnet, {
            tags: tags ? tags.split(',').map(tag => tag.trim()) : undefined
        })

        // Mark OAuth client secret as secret and export
        core.setSecret(oauthClient.key)
        core.exportVariable('TS_OAUTH_CLIENT_ID', oauthClient.id)
        core.exportVariable('TS_OAUTH_CLIENT_SECRET', oauthClient.key)
        core.setOutput('ts-oauth-client-id', oauthClient.id)
        core.setOutput('ts-oauth-client-secret', oauthClient.key)
        
        // Output partial client info for debugging
        core.info(`✅ OAuth client created: ${oauthClient.id}`)
        core.info(`✅ OAuth client secret: ${oauthClient.key.substring(0, 20)}...`)

        core.info('✅ Tailscale credentials configured successfully!')
        
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        core.error(`❌ Failed to configure Tailscale credentials: ${errorMessage}`)
        core.setFailed(errorMessage)
    }
}

async function exchangeTokenForTailscaleToken(
    clientId: string,
    jwt: string
): Promise<string> {
    const form = new URLSearchParams({
        client_id: clientId,
        jwt: jwt  // The undocumented API uses 'jwt' not 'subject_token'
    })

    const httpClient = new http.HttpClient('configure-tailscale-credentials', undefined, {
        headers: {
            'User-Agent': 'configure-tailscale-credentials-action',
            'Accept': 'application/json'
        }
    })

    try {
        core.info(`Making token exchange request to: https://api.tailscale.com/api/v2/oauth/token-exchange`)
        core.info(`Client ID: ${clientId}`)
        core.info(`JWT length: ${jwt.length}`)
        
        const response = await httpClient.post(
            'https://api.tailscale.com/api/v2/oauth/token-exchange',
            form.toString(),
            {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        )

        const responseBody = await response.readBody()
        core.info(`Response status: ${response.message.statusCode}`)
        core.info(`Response headers: ${JSON.stringify(response.message.headers)}`)
        
        // Log response body for debugging (but redact sensitive data)
        if (response.message.statusCode !== 200) {
            core.error(`Full error response: ${responseBody}`)
        } else {
            core.info(`Response body length: ${responseBody.length}`)
        }

        if (response.message.statusCode !== 200) {
            let errorMessage = 'Unknown error'
            try {
                const errorResponse: ErrorResponse = JSON.parse(responseBody)
                errorMessage = errorResponse.error_description || errorResponse.error || errorResponse.message || 'Unknown error'
                core.error(`Parsed error: ${JSON.stringify(errorResponse)}`)
            } catch (parseError) {
                core.error(`Failed to parse error response: ${parseError}`)
                core.error(`Raw response: ${responseBody}`)
            }
            
            throw new Error(
                `Token exchange failed (${response.message.statusCode}): ${errorMessage}`
            )
        }

        const tokenResponse: TokenExchangeResponse = JSON.parse(responseBody)
        
        if (!tokenResponse.access_token) {
            throw new Error('No access token received from Tailscale')
        }

        return tokenResponse.access_token
        
    } catch (error) {
        if (error instanceof Error) {
            core.error(`Token exchange error details: ${error.message}`)
            core.error(`Error stack: ${error.stack}`)
            throw error
        }
        core.error(`Unknown error type: ${typeof error}`)
        core.error(`Error value: ${String(error)}`)
        throw new Error(`Token exchange request failed: ${String(error)}`)
    }
}

async function createTailscaleOAuthClient(
    accessToken: string,
    tailnet: string,
    options: {
        tags?: string[]
    }
): Promise<OAuthClientResponse> {
    const clientSpec = {
        keyType: 'client',
        capabilities: {
            devices: {
                create: {
                    ephemeral: true,
                    preauthorized: true,
                    reusable: false,
                    ...(options.tags && { tags: options.tags })
                }
            }
        },
        scopes: ['all:read', 'devices:write'],
        description: 'GitHub Actions OAuth client',
        ...(options.tags && { tags: options.tags })
    }

    const httpClient = new http.HttpClient('configure-tailscale-credentials', undefined, {
        headers: {
            'User-Agent': 'configure-tailscale-credentials-action',
            'Accept': 'application/json'
        }
    })

    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    }

    try {
        const response = await httpClient.postJson(
            `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/keys`,
            clientSpec,
            headers
        )

        if (response.statusCode !== 200 && response.statusCode !== 201) {
            const errorResponse = response.result as ErrorResponse
            throw new Error(
                `OAuth client creation failed (${response.statusCode}): ${errorResponse.message || errorResponse.error || 'Unknown error'}`
            )
        }

        const oauthClientResponse = response.result as OAuthClientResponse

        if (!oauthClientResponse.key || !oauthClientResponse.id) {
            throw new Error('No OAuth client credentials received from Tailscale')
        }

        return oauthClientResponse
        
    } catch (error) {
        if (error instanceof Error) {
            throw error
        }
        throw new Error(`OAuth client creation request failed: ${String(error)}`)
    }
}

// Execute the action
run()