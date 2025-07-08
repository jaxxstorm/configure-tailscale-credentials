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
        const scope = core.getInput('scope') || 'auth_keys devices:core'

        core.info('Starting Tailscale OAuth authentication flow...')

        // 1) Request JWT from GitHub with custom audience
        core.info(`Requesting GitHub ID token with audience: ${audience}`)
        const jwt = await core.getIDToken(audience)
        
        if (!jwt) {
            throw new Error('Failed to obtain GitHub ID token. Ensure id-token: write permission is set.')
        }

        // 2) Exchange JWT for Tailscale API token
        core.info('Exchanging GitHub ID token for Tailscale access token...')
        const accessToken = await exchangeTokenForTailscaleToken(clientId, jwt, scope)

        // Mark token as secret and export
        core.setSecret(accessToken)
        core.exportVariable('TS_ACCESS_TOKEN', accessToken)
        core.setOutput('ts-access-token', accessToken)
        
        // Output partial token for debugging (first 10 chars only)
        core.info(`✅ Access token created: ${accessToken.substring(0, 10)}...`)

        // 3) Create ephemeral auth key
        core.info('Creating Tailscale auth key...')
        const authKey = await createTailscaleAuthKey(accessToken, tailnet, {
            tags: tags ? tags.split(',').map(tag => tag.trim()) : undefined
        })

        // Mark auth key as secret and export
        core.setSecret(authKey)
        core.exportVariable('TS_AUTH_KEY', authKey)
        core.setOutput('ts-auth-key', authKey)
        
        // Output partial auth key for debugging (first 10 chars only)
        core.info(`✅ Auth key created: ${authKey.substring(0, 10)}...`)

        core.info('✅ Tailscale credentials configured successfully!')
        
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        core.error(`❌ Failed to configure Tailscale credentials: ${errorMessage}`)
        core.setFailed(errorMessage)
    }
}

async function exchangeTokenForTailscaleToken(
    clientId: string,
    jwt: string,
    scope: string
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
        const response = await httpClient.post(
            'https://api.tailscale.com/api/v2/oauth/token-exchange',
            form.toString(),
            {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        )

        const responseBody = await response.readBody()
        
        if (response.message.statusCode !== 200) {
            const errorResponse: ErrorResponse = JSON.parse(responseBody)
            throw new Error(
                `Token exchange failed (${response.message.statusCode}): ${errorResponse.error || 'Unknown error'}`
            )
        }

        const tokenResponse: TokenExchangeResponse = JSON.parse(responseBody)
        
        if (!tokenResponse.access_token) {
            throw new Error('No access token received from Tailscale')
        }

        return tokenResponse.access_token
        
    } catch (error) {
        if (error instanceof Error) {
            throw error
        }
        throw new Error(`Token exchange request failed: ${String(error)}`)
    }
}

async function createTailscaleAuthKey(
    accessToken: string,
    tailnet: string,
    options: {
        tags?: string[]
    }
): Promise<string> {
    const keySpec = {
        capabilities: {
            devices: {
                create: {
                    ephemeral: true, // Default to true for CI keys
                    preauthorized: true, // Default to true for CI keys  
                    reusable: false, // Default to false for CI keys
                    ...(options.tags && { tags: options.tags })
                }
            }
        }
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
            keySpec,
            headers
        )

        if (response.statusCode !== 200 && response.statusCode !== 201) {
            const errorResponse = response.result as ErrorResponse
            throw new Error(
                `Auth key creation failed (${response.statusCode}): ${errorResponse.message || errorResponse.error || 'Unknown error'}`
            )
        }

        const authKeyResponse = response.result as AuthKeyResponse

        if (!authKeyResponse.key) {
            throw new Error('No auth key received from Tailscale')
        }

        return authKeyResponse.key
        
    } catch (error) {
        if (error instanceof Error) {
            throw error
        }
        throw new Error(`Auth key creation request failed: ${String(error)}`)
    }
}

// Execute the action
run()