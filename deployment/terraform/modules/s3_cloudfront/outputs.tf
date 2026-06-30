output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.frontend.domain_name
}

output "s3_bucket_id" {
  value = aws_s3_bucket.frontend.id
}
