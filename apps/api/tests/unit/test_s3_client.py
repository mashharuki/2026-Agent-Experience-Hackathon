"""A signed upload form must point at the bucket's own region: the global endpoint answers 307,
which a browser cannot follow for a cross-origin POST."""

from photoprep_api.aws import S3Uploads, make_s3_client


def test_the_signed_form_targets_the_regional_endpoint(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    uploads = S3Uploads("my-bucket", make_s3_client("ap-northeast-1"))
    form = uploads.presign_post("uploads/s/p.jpg", "image/jpeg", 1000, 60)
    assert form["url"] == "https://my-bucket.s3.ap-northeast-1.amazonaws.com/"


def test_the_default_client_is_the_regional_one(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setenv("AWS_REGION", "ap-northeast-1")
    form = S3Uploads("my-bucket").presign_post("uploads/s/p.jpg", "image/jpeg", 1000, 60)
    assert ".s3.ap-northeast-1.amazonaws.com" in form["url"]
