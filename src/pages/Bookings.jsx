import { useState } from 'react';
import Rent from './Rent';
import Chura from './Chura';

// Bookings page: Jewellery booking (rent) and Chura booking
const KEY = 'sk-booking-kind';
export const openBookingKind = (k) => { try { localStorage.setItem(KEY, k); } catch { /* ignore */ } };

export default function Bookings(props) {
  const [kind, setKindState] = useState(() => { try { return localStorage.getItem(KEY) || 'jewellery'; } catch { return 'jewellery'; } });
  const setKind = (k) => { setKindState(k); openBookingKind(k); };
  return (
    <>
      <div className="place-switch booking-switch">
        <button className={kind === 'jewellery' ? 'on' : ''} onClick={() => setKind('jewellery')}>💍 Jewellery booking</button>
        <button className={kind === 'chura' ? 'on' : ''} onClick={() => setKind('chura')}>🔴 Chura booking</button>
      </div>
      {kind === 'chura' ? <Chura {...props} /> : <Rent {...props} />}
    </>
  );
}
