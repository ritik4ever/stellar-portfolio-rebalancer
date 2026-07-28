output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.frontend.domain_name
}

output "s3_bucket_id" {
  value = aws_s3_bucket.frontend.id
}

# Exposed so the post-deploy CloudFront invalidation step can reference the
# correct distribution without hard-coding the ID in CI (#1486).
output "cloudfront_distribution_id" {
  description = "The CloudFront distribution ID — pass as CLOUDFRONT_DISTRIBUTION_ID to cloudfront-invalidate.sh."
  value       = aws_cloudfront_distribution.frontend.id
}
