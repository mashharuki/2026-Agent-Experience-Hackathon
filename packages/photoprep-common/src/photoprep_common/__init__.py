"""Shared by apps/api and apps/worker so both apply the same state rules and talk to
DynamoDB the same way. Keep it small and dependency-free (boto3 only)."""
