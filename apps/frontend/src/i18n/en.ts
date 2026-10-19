import type { MessageKey } from "./ja";

export const en: Record<MessageKey, string> = {
  "clarify.heading": "A quick question",
  "clarify.scope": "Which area would you like help with?",
  "clarify.detail": "Which part would you like help with?",
  "clarify.submit": "Answer and continue",
  "clarify.missing":
    "This question cannot be answered. Please finish and start again.",
  "clarify.captureRequired":
    "Your answer was saved. Please take another photo because the area changed or the observation expired.",

  "consult.restrictions": "What should stay unchanged?",
  "consult.restrictionsHelp":
    "Select restrictions here. Writing them only in the wish field does not confirm them as restrictions.",
  "restriction.no_touch_brow": "Do not touch my brows",
  "restriction.keep_brow_shape": "Keep my brow shape",
  "restriction.no_touch_bangs": "Do not touch my bangs",

  "app.title": "A little prep before the photo",
  "app.tagline":
    "Before your photo, try one small change to your brows or bangs.",
  "lang.label": "Language",
  "lang.ja": "日本語",
  "lang.en": "English",

  "gate.loading": "Checking…",
  "gate.error": "We could not sign you in. Please try again.",
  "gate.signInPrompt": "Please sign in to start (invitation only).",
  "gate.signIn": "Sign in",

  "heading.consult": "Consult",
  "heading.capture": "First photo",
  "heading.advice": "Try one thing",
  "heading.compare": "Compare and choose",
  "heading.done": "All done",

  "door.checking": "Checking whether we are open",
  "door.checkFailed":
    "We could not check whether we are open. Please check your connection and try again.",
  "door.recheck": "Check again",
  "door.worker_stopped": "We are closed right now. Please try again later.",
  "door.warming_up": "We are getting ready.",
  "door.quota_exhausted":
    "Today's limit has been reached. Please try again tomorrow.",
  "door.maintenance": "We are under maintenance. Please try again later.",
  "door.reopen": "We expect to reopen around {time}.",

  "consult.scopeLabel": "What should we look at?",
  "consult.journey":
    "Take a photo, try one step if you wish, then compare. You can save a photo you choose, or finish without changing or saving anything.",
  "consult.brow": "Brows",
  "consult.bangs": "Bangs",
  "consult.lookFirst": "Take a look first",
  "consult.wishLabel": "Your wish (optional)",
  "consult.wishHelp":
    "Example: I don't want to change my brow shape, but I'd like to tidy the direction of the hairs (up to 200 characters)",
  "consult.consentText":
    "Your photo is sent to the cloud (AWS) and analyzed to produce advice. Photos are deleted after processing; periodic cleanup retries leftovers, with a 24-hour deletion target. Observation notes can be used for up to 10 minutes to answer a question, then deleted after answering or finishing. Periodic cleanup also removes expired notes. Comparison photos are held on your device only while the screen is open. Files you choose to save remain on your device after finishing.",
  "consult.consentCheck": "I agree to the cloud analysis",
  "consult.submit": "Go to the photo",
  "consult.decline": "I do not agree (leave)",

  "capture.instruction": "Line up your face in the frame and take a photo.",
  "capture.photoAlt": "The photo you took",
  "capture.send": "Consult with this photo",
  "capture.retake": "Retake",
  "capture.finish": "Finish as I am",

  "run.uploading": "Sending your photo",
  "run.analysing": "Analyzing",
  "run.timeout": "Getting the result is taking a while.",
  "run.failed":
    "The analysis did not work. Please retake the photo and try again.",
  "run.uploadFailed": "We could not send your photo. Please try again.",

  "try.trying":
    "When you are done, take another photo in the same position and light. No new suggestion will appear while you tidy up.",
  "try.do": "Try it",
  "try.another": "Another suggestion",
  "try.check": "I've tidied up, check",
  "try.afterAlt": "The photo after tidying",
  "try.sendAfter": "Check with this photo",
  "try.notComparable":
    "The conditions differ from the earlier photo, so they cannot be compared. Please retake it.",

  "compare.beforeLabel": "Before",
  "compare.mode": "Comparison layout",
  "compare.side": "View side by side",
  "compare.single": "Switch one at a time",
  "compare.view": "Photo to view",
  "compare.afterLabel": "After",
  "compare.question": "Which do you prefer?",
  "compare.preferBefore": "I prefer before",
  "compare.preferAfter": "I prefer after",
  "compare.unclear": "I can't tell the difference",
  "compare.recorded": "Your choice was saved. Any choice is fine.",
  "compare.finish": "Finish",
  "compare.nextLabel": "If you like, one more step",
  "compare.nextButton": "Try one more",

  "save.help":
    "Saving is optional. Choose a photo to save separately from your preference answer. Saved files remain on your device after finishing.",
  "save.current": "Save this photo",
  "save.before": "Save before photo",
  "save.after": "Save after photo",
  "save.requested":
    "The save action was started. Check your browser's download location. If the file is missing, try again.",
  "save.failed":
    "We could not start the save action. You can try again or finish as you are.",

  "done.declined":
    "You did not agree, so no photo was sent. You can start again any time.",
  "done.finished":
    "The consultation is over. Photos held by this screen were discarded. Files you chose to save remain on your device. Deletion of cloud photos and observation notes is requested. If the request fails, periodic cleanup handles leftovers.",
  "done.restart": "Start again",

  "camera.preview": "Camera preview",
  "camera.reference": "Before photo for alignment",
  "camera.guide": "Overlay the before photo for alignment",
  "camera.guideHelp":
    "Aim for the same angle, distance and light. The guide is not included in your photo and does not guarantee matching conditions.",
  "camera.failed":
    "We could not take the photo. You can try again or finish as you are.",
  "camera.denied":
    "Camera access is not allowed. Please allow it in your browser settings.",
  "camera.unavailable": "We could not use the camera.",
  "camera.shoot": "Take photo",
  "camera.testImage": "Use a test image",
  "camera.testImageLabel": "Mock",

  "error.session_ended": "This consultation has ended. Please start again.",
  "error.change_limit_reached":
    "You can try up to two changes. You can compare the photos so far and choose.",
  "error.analysis_limit_reached":
    "This consultation has reached its analysis limit.",
  "error.too_many_requests": "Please try again in a little while.",
  "error.quota_exceeded": "Today's limit has been reached.",
  "error.service_unavailable":
    "We are not accepting requests now. Please try again later.",
  "error.not_accepting":
    "We are not accepting requests now. Please try again later.",
  "error.unauthenticated": "Your sign-in has expired. Please sign in again.",
  "error.generic": "Something went wrong. Please try again.",
  "error.network":
    "Something went wrong. Please check your connection and try again.",

  "pwa.update":
    "A new version is available. Updating reloads the page, and any photo in progress will be lost.",
  "pwa.updateButton": "Update",
  "pwa.offline":
    "You are offline. Photos cannot be analyzed or sent until the connection returns.",

  "mock.notice":
    "This is not connected to the API on AWS. Photos never leave this device, and the advice is fixed replay data. It is not a real analysis.",
  "mock.title": "Mock mode.",
  "mock.scenario": "Mock scenario",
  "mock.scenario.normal": "Normal",
  "mock.scenario.backlight": "Backlit (retake guidance)",
  "mock.scenario.vague": "Vague (clarifying question)",
  "mock.scenario.error": "Analysis failure",
  "mock.door": "Door",
  "mock.doorState": "Door state",
  "mock.door.open": "Open",
  "mock.door.stopped": "Stopped",
  "mock.door.warming": "Warming up",
  "mock.door.quota": "Limit reached",
};
