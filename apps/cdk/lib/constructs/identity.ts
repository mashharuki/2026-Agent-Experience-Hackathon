import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { acknowledge } from "../nag";

export interface IdentityProps {
  /** Allowed OAuth redirect URLs (SPA callback). */
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
  /** Globally unique Cognito hosted-UI domain prefix (lowercase, no "aws"/"cognito"). */
  readonly domainPrefix: string;
  /** RETAIN keeps the user pool on stack deletion; DESTROY allows full teardown. */
  readonly removalPolicy: cdk.RemovalPolicy;
}

/**
 * Cognito user pool for an email-verified SPA: Authorization Code + PKCE with a
 * public client (no client secret). The API accepts only access tokens carrying the
 * `photoprep/session` scope.
 */
export class Identity extends Construct {
  static readonly RESOURCE_SERVER_ID = "photoprep";
  static readonly SESSION_SCOPE_NAME = "session";
  /** Full scope string as it appears in the access token and on API routes. */
  static readonly SESSION_SCOPE = "photoprep/session";

  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly issuerUrl: string;
  /** Base URL of the Cognito hosted UI (the OAuth endpoints live under it). */
  readonly hostedUiUrl: string;

  constructor(scope: Construct, id: string, props: IdentityProps) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      userVerification: { emailStyle: cognito.VerificationEmailStyle.CODE },
      signInCaseSensitive: false,
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: props.removalPolicy === cdk.RemovalPolicy.RETAIN,
      removalPolicy: props.removalPolicy,
    });

    const resourceServer = this.userPool.addResourceServer(
      "ApiResourceServer",
      {
        identifier: Identity.RESOURCE_SERVER_ID,
        scopes: [
          new cognito.ResourceServerScope({
            scopeName: Identity.SESSION_SCOPE_NAME,
            scopeDescription: "Create and use grooming-assist sessions",
          }),
        ],
      },
    );

    this.client = this.userPool.addClient("SpaClient", {
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(1),
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      oAuth: {
        // Authorization Code only (PKCE is required for public clients); no implicit flow.
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.resourceServer(
            resourceServer,
            new cognito.ResourceServerScope({
              scopeName: Identity.SESSION_SCOPE_NAME,
              scopeDescription: "Create and use grooming-assist sessions",
            }),
          ),
        ],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
      },
    });

    this.userPool.addDomain("HostedUiDomain", {
      cognitoDomain: { domainPrefix: props.domainPrefix },
    });
    this.hostedUiUrl = `https://${props.domainPrefix}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`;

    this.issuerUrl = `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${this.userPool.userPoolId}`;

    acknowledge(this.userPool, [
      {
        id: "AwsSolutions::AwsSolutions-COG8",
        reason:
          "Plus threat protection is not budgeted for this temporary hackathon deployment. Registration requires email verification, passwords are strong, API quotas cap usage, and the worker is manually started and stopped (constitution principle II).",
      },
      {
        id: "AwsSolutions::AwsSolutions-COG2",
        reason:
          "MFA (TOTP) is available but optional for this temporary development and demo deployment. Email verification is required for self-registration; revisit mandatory MFA before production use.",
      },
    ]);
  }
}
