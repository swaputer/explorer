export function TokenMark() {
  return (
    <svg className="token-mark" viewBox="0 0 120 120" role="img" aria-label="Mintable SRC20 token mark">
      <circle className="token-mark__base token-mark__base--one" cx="60" cy="60" r="44" />
      <circle className="token-mark__base token-mark__base--two" cx="60" cy="60" r="31" />
      <path className="token-mark__accent" d="M24 69A38 38 0 0 1 73 24" />
      <path className="token-mark__accent" d="M94 51a38 38 0 0 1-47 44" />
    </svg>
  );
}
