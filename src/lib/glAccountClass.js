export function isBalanceClassAccount(accountNumber) {
  return /^[123]/.test(String(accountNumber ?? ""));
}
