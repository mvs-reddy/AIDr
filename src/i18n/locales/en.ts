/**
 * Base strings. Keys are grouped by surface, and every `safety.*` value carries a
 * human-review requirement — see i18n/index.ts.
 */
export default {
  common: {
    connect: 'Connect',
    cancel: 'Cancel',
    continue: 'Continue',
    skip: 'Skip',
    notNow: 'Not now',
    back: 'Back',
    delete: 'Delete',
    revoke: 'Revoke',
    optional: 'Optional',
    readOnly: 'Read-only',
    notConnected: 'Not connected',
  },

  home: {
    greeting: {
      morning: 'Good morning',
      afternoon: 'Good afternoon',
      evening: 'Good evening',
    },
    startWorkflow: 'Start a workflow',
    noMetrics: 'No metrics yet',
    noMetricsBody: 'Connect %{source} to show read-only wellness metrics.',
    heroTitle: 'Prepare for your next visit',
    heroBody: 'Turn your recent numbers into questions · 2 min',
    weeklyDigest: 'Weekly digest',
    today: 'Today',
    steps: 'Steps',
    move: 'Move',
    synced: 'Synced',
    syncing: 'Syncing',
    partlyConnected: 'Partly connected',
  },

  workflow: {
    eyebrow: 'Workflow',
    contextIncluded: 'Context included',
    addNotes: 'Add notes · optional',
    focus: 'Focus · optional',
    addFromDocument: 'Add from a document',
    disclosure:
      'Redacted on this device, then sent with normalized health summaries to your %{model} account. Redaction is automated, so review your text first.',
    documentsAttached: {
      one: '%{count} document attached · originals stay on this device',
      other: '%{count} documents attached · originals stay on this device',
    },
  },

  consent: {
    eyebrow: 'Before this leaves your phone',
    whatWillBeSent: 'What will be sent',
    whatStaysHere: 'What stays here',
    destination: 'Destination',
    send: 'Send and run',
    identifiersRemoved: '%{count} removed',
    noModelSwitch: 'Under your own account. AIDr. will not switch to a different model on your behalf.',
  },

  redaction: {
    title: 'Check what leaves',
    needsReview: 'Needs your eyes',
    alreadyRemoved: 'Already removed',
    exactPayload: 'Exactly what will be sent',
    placeholderNote:
      'Placeholders like [NAME_1] are intentional. The model is told to leave them alone.',
    looksRight: 'Looks right, continue',
    cancelRun: 'Cancel this run',
  },

  note: {
    title: 'New note',
    prompt: 'How are you feeling?',
    body:
      'Jot down whatever is on your mind — how you feel, a symptom, how you slept. AIDr. files it into your record.',
    privacy:
      'Identifiers are stripped on this device before AIDr. reads it. Your raw words never leave your phone.',
    saveAndReflect: 'Save & reflect',
    saveOnly: 'Save without reflecting',
    words: { one: '%{count} word', other: '%{count} words' },
  },

  journal: {
    eyebrow: 'Your record',
    title: 'Your health story',
    filters: { all: 'Everything', reads: 'Daily reads', runs: 'Workflows', notes: 'Notes' },
    empty: 'Nothing here yet',
    emptyBody:
      'Your daily reads, saved workflows and notes collect here so you can see how things change over months, not just today.',
  },

  settings: {
    title: 'Control your privacy',
    model: 'Model',
    appearance: 'Appearance',
    dailyBriefs: 'Daily briefs',
    auditTraces: 'Audit traces · private',
    privacyLog: 'Privacy log',
    sharedExports: 'Shared exports',
    analytics: 'Analytics',
    aiAccount: 'AI account',
    localData: 'Local data',
    about: 'About',
    noFallback: 'No silent fallback',
    noFallbackBody:
      'If this model is unavailable, AIDr. stops and tells you rather than quietly using a different one.',
    deleteAll: 'Delete all local data',
    revokeNote:
      'Revoking stops future access. It cannot pull back a file or screenshot someone already saved.',
  },

  medication: {
    verifyTitle: 'Check this before reminders start',
    verifyBody:
      'AIDr. reminds you of a dose you have confirmed. It never decides or changes a dose. Check every field against the label or your clinician’s instructions.',
    doseTakenFrom: 'Dose text, quoted from: %{source}',
    lockScreenPrivacy: 'Hide medicine names on the lock screen',
    notLogged: 'Not logged',
    notLoggedBody:
      'This reminder was not acknowledged. That is not the same as a dose you did not take — review and log it if you would like.',
    missedDoseNoInstruction:
      'No stored instruction covers a missed dose for this medicine. Please check the label or contact your pharmacist.',
  },

  // Human-reviewed strings. Do not machine-translate.
  safety: {
    reviewedBy: 'clinical-safety-review-2026-07',
    emergencyMedicalTitle: 'This may need urgent care',
    emergencyMedicalBody:
      'What you described can be a medical emergency. Contact your local emergency number or go to the nearest emergency department now. AIDr. has paused this workflow and has not sent anything.',
    emergencyMentalTitle: 'Support is available right now',
    emergencyMentalBody:
      'You matter, and you do not have to handle this alone. Please contact your local crisis line or emergency services, or reach out to someone you trust. AIDr. has paused this workflow and has not sent anything.',
    disclaimer:
      'General health information, not medical advice. AIDr. does not diagnose, treat or prescribe. Always consult a qualified professional.',
    blockedOutput:
      'AIDr. blocked this response because it crossed a clinical boundary. Nothing was saved. You can retry, or rephrase what you want to understand.',
  },
} as const;
