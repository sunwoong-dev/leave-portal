// 회원가입/비밀번호 변경 양쪽에서 공유하는 비밀번호 정책.
// 아이디 규칙(영문/숫자/밑줄만 허용, app/signup/page.tsx)과 동일하게 영문/숫자 기반에
// 비밀번호 전용으로 허용할 특수문자만 추가.
export const PASSWORD_MIN_LENGTH = 10;
export const ALLOWED_SPECIAL_CHARS = "!@#$%^&*()_-+=";
const ALLOWED_SPECIAL_REGEX = "!@#\\$%\\^&\\*\\(\\)_\\-\\+=";

export interface PasswordPolicyResult {
  hasLetter: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
  onlyAllowedChars: boolean;
  longEnough: boolean;
  valid: boolean;
}

export function checkPasswordPolicy(pw: string): PasswordPolicyResult {
  const hasLetter = /[A-Za-z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSpecial = new RegExp(`[${ALLOWED_SPECIAL_REGEX}]`).test(pw);
  const onlyAllowedChars = new RegExp(`^[A-Za-z0-9${ALLOWED_SPECIAL_REGEX}]*$`).test(pw);
  const longEnough = pw.length >= PASSWORD_MIN_LENGTH;
  return {
    hasLetter,
    hasDigit,
    hasSpecial,
    onlyAllowedChars,
    longEnough,
    valid: hasLetter && hasDigit && hasSpecial && onlyAllowedChars && longEnough,
  };
}
