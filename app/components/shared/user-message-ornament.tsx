/** Slim clock-hand corners; the centre stays clear of the avatar and text. */
export function UserMessageOrnament() {
  return (
    <span className="user-message-ornament" aria-hidden="true">
      <span className="user-message-corner opening" />
      <span className="user-message-corner closing" />
    </span>
  );
}
