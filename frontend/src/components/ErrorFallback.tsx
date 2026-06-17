import React from "react";
interface Props { error: Error; resetError: () => void; }
const ErrorFallback: React.FC<Props> = ({ error, resetError }) => (
  <div style={{ padding:"20px",margin:"16px",borderRadius:"8px",background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",textAlign:"center" }}>
    <h3>Something went wrong</h3>
    <p style={{ color:"#ef4444",fontSize:"14px" }}>{error.message}</p>
    <button onClick={resetError} style={{ marginTop:"12px",padding:"8px 16px",background:"#ef4444",color:"white",border:"none",borderRadius:"6px",cursor:"pointer" }}>Try Again</button>
  </div>
);
export default ErrorFallback;
