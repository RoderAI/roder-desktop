export function DotMatrixSpinner(): React.JSX.Element {
  return (
    <span className="dotmatrix-spinner" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} className="dotmatrix-spinner-dot" />
      ))}
    </span>
  );
}
