import { useParams } from 'react-router-dom';
import LabReport from './Lab/LabReport';

/**
 * Opened from the QR code on a printed lab report (/r/<token>): the patient's
 * details and results, no login. View and print only.
 */
export default function PublicReport() {
  const { token } = useParams();
  return (
    <div className="public-report">
      <LabReport publicToken={token} />
    </div>
  );
}
