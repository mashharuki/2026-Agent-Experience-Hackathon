import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { acknowledge } from "../nag";

/**
 * Static SPA hosting: a private S3 bucket reached only through CloudFront (origin
 * access control). No public S3 website endpoint. Assets are uploaded by the build
 * pipeline task (T062), not by this construct.
 */
export class Frontend extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Build output only; it can always be rebuilt from the repository.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(
      this,
      "SecurityHeaders",
      {
        securityHeadersBehavior: {
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.days(365),
            includeSubdomains: true,
            override: true,
          },
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER,
            override: true,
          },
        },
        // Camera is the one powerful feature the SPA needs; everything else is off.
        customHeadersBehavior: {
          customHeaders: [
            {
              header: "Permissions-Policy",
              value: "camera=(self), microphone=(), geolocation=()",
              override: true,
            },
          ],
        },
      },
    );

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "Pre-photo grooming assistant SPA",
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // PRICE_CLASS_200 includes Japan (class 100 does not).
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
      },
      // Client-side routing: unknown paths fall back to the SPA entry point.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(10),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(10),
        },
      ],
    });

    acknowledge(this.bucket, [
      {
        id: "AwsSolutions::AwsSolutions-S1",
        reason:
          "Server access logs are not enabled: the bucket holds only public build output, and a log bucket adds cost without security value here.",
      },
    ]);
    acknowledge(this.distribution, [
      {
        id: "AwsSolutions::AwsSolutions-CFR1",
        reason:
          "No geo restriction: invited users may be anywhere; access is controlled by Cognito.",
      },
      {
        id: "AwsSolutions::AwsSolutions-CFR2",
        reason:
          "AWS WAF adds a fixed monthly cost (constitution principle II). Abuse is limited by invitation-only sign-in, API throttling and per-user/global quotas; the distribution serves only static, non-sensitive files.",
      },
      {
        id: "AwsSolutions::AwsSolutions-CFR3",
        reason:
          "Access logging is not enabled: it would require a log bucket that retains request metadata and adds cost.",
      },
      {
        id: "AwsSolutions::AwsSolutions-CFR4",
        reason:
          "The default *.cloudfront.net certificate does not allow a minimum TLS version to be enforced. Moving to a custom domain and certificate is out of scope for the hackathon.",
      },
    ]);
  }
}
