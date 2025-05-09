import {JWTPayload, decodeJwt} from 'jose';

/**
 * Decodes a JWT access token without verifying the signature
 *
 * @param accessToken - The JWT access token to decode
 * @returns The decoded token payload
 */
export default function decodeAccessToken(accessToken: string): JWTPayload {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('Access Token must be a non-empty string.');
  }

  try {
    // Decode the token without verification
    const payload = decodeJwt(accessToken);
    return payload;
  } catch (error: any) {
    throw new Error(`Failed to decode access token: ${error instanceof Error ? error.message : String(error)}`);
  }
}
