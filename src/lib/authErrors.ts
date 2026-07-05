interface AuthErrorLike {
  message?: string;
  code?: string;
}

const CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password. Please try again.',
  user_already_exists: 'An account with this email already exists. Try signing in instead.',
  email_exists: 'An account with this email already exists. Try signing in instead.',
  weak_password: 'Choose a stronger password.',
  same_password: 'Your new password must be different from your current password.',
  over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
  over_email_send_rate_limit: 'Too many emails requested. Please wait a few minutes and try again.',
  email_not_confirmed: 'Please confirm your email address before signing in.',
};

const MESSAGE_PATTERNS: Array<{ match: RegExp; friendly: string }> = [
  { match: /invalid login credentials/i, friendly: CODE_MESSAGES.invalid_credentials },
  { match: /user already registered/i, friendly: CODE_MESSAGES.user_already_exists },
  { match: /password should be at least|weak password/i, friendly: CODE_MESSAGES.weak_password },
  { match: /rate limit/i, friendly: CODE_MESSAGES.over_request_rate_limit },
  { match: /email not confirmed/i, friendly: CODE_MESSAGES.email_not_confirmed },
];

export function friendlyAuthError(error: AuthErrorLike | null | undefined): string {
  const raw = error?.message ?? 'Something went wrong. Please try again.';
  if (error?.code && CODE_MESSAGES[error.code]) return CODE_MESSAGES[error.code];
  const hit = MESSAGE_PATTERNS.find(({ match }) => match.test(raw));
  return hit ? hit.friendly : raw;
}
