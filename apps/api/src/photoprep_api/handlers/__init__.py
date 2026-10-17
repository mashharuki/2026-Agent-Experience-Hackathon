"""operationId -> handler function table used by the Connexion resolver."""

from . import analyses, feedback, jobs, sessions, uploads

HANDLERS = {
    "createSession": sessions.create_session,
    "createUpload": uploads.create_upload,
    "requestAnalysis": analyses.request_analysis,
    "getJob": jobs.get_job,
    "recordFeedback": feedback.record_feedback,
}
