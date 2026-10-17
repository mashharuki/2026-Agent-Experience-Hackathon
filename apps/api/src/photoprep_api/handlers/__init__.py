"""operationId -> handler function table used by the Connexion resolver."""

from . import analyses, feedback, jobs, sessions, status, uploads

HANDLERS = {
    "getServiceStatus": status.get_service_status,
    "createSession": sessions.create_session,
    "endSession": sessions.end_session,
    "createUpload": uploads.create_upload,
    "requestAnalysis": analyses.request_analysis,
    "getJob": jobs.get_job,
    "recordFeedback": feedback.record_feedback,
}
