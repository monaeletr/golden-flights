import { createContext, useContext, useEffect, useState } from "react";
import { Routes, Route, Link, NavLink, useNavigate, useLocation, Navigate } from "react-router-dom";

const airports = [
  { code: "YYZ", city: "Toronto" }, { code: "YVR", city: "Vancouver" },
  { code: "YUL", city: "Montreal" }, { code: "YYC", city: "Calgary" },
  { code: "JFK", city: "New York" }, { code: "LAX", city: "Los Angeles" },
  { code: "LHR", city: "London" }, { code: "CDG", city: "Paris" },
  { code: "NRT", city: "Tokyo" }, { code: "DXB", city: "Dubai" },
];
const API_BASE = import.meta.env.VITE_API_URL || "";
const formatLocalDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = () => formatLocalDate(new Date());
const defaultFlightDate = () => { const date = new Date(); date.setDate(date.getDate() + 7); return formatLocalDate(date); };

async function apiRequest(path, { method = "GET", body, token } = {}) {
  const authToken = token || localStorage.getItem("gf_token");
  const response = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function mapApiBooking(b) {
  const departure = new Date(b.flight.departureDatetime);
  const arrival = new Date(b.flight.arrivalDatetime);
  return {
    id: b.bookingReference,
    bookingId: b.bookingId,
    status: b.status,
    bookedAt: b.bookedAt,
    search: { date: departure.toISOString().slice(0, 10), passengers: 1 },
    flight: {
      id: b.flight.flightId,
      from: b.flight.departureCity,
      to: b.flight.arrivalCity,
      departure: departure.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      arrival: arrival.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      departureDatetime: b.flight.departureDatetime,
      arrivalDatetime: b.flight.arrivalDatetime,
      airline: b.flight.airline,
      flightNumber: b.flight.flightNumber,
    },
    seats: b.seat?.seatNumber ? [b.seat.seatNumber] : [],
    total: Number(b.pricing?.total || 0),
    passenger: {
      firstName: b.passengerFirstName || "",
      lastName: b.passengerLastName || "",
      email: b.passengerEmail || "",
    },
    accessibilityNotes: b.accessibilityNotes || "",
    payment: b.payment || null,
    charges: b.pricing?.charges || [],
  };
}

function mapApiFlight(f) {
  const departure = new Date(f.departureDatetime);
  const arrival = new Date(f.arrivalDatetime);
  const durationMinutes = Math.max(0, Math.round((arrival - departure) / 60000));
  return {
    id: f.flightId,
    flightNumber: f.flightNumber,
    from: f.departureCity,
    to: f.arrivalCity,
    departure: departure.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    arrival: arrival.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    departureDatetime: f.departureDatetime,
    arrivalDatetime: f.arrivalDatetime,
    date: departure.toISOString().slice(0, 10),
    airline: f.airline,
    duration: `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`,
    price: Number(f.basePrice),
    availableSeats: Number(f.availableSeats || 0),
  };
}

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(localStorage.getItem("gf_token")));
  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [draft, setDraft] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("gf_token"));

  useEffect(() => {
    let active = true;
    if (!token) {
      setAuthLoading(false);
      setUser(null);
      return undefined;
    }
    apiRequest("/auth/me", { token })
      .then(({ user: currentUser }) => {
        if (active) setUser({ ...currentUser, name: [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") });
      })
      .catch(() => {
        localStorage.removeItem("gf_token");
        if (active) { setToken(null); setUser(null); }
      })
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, [token]);

  const refreshBookings = async () => {
    if (!token) return;
    setBookingsLoading(true);
    setBookingError("");
    try {
      const data = await apiRequest("/bookings?view=all", { token });
      setBookings((data.bookings || []).map(mapApiBooking));
    } catch (error) {
      setBookingError(error.message);
      setBookings([]);
    } finally {
      setBookingsLoading(false);
    }
  };

  useEffect(() => {
    if (user && token) refreshBookings();
    else setBookings([]);
  }, [user, token]);

  const auth = {
    user,
    loading: authLoading,
    login: async ({ email, password }) => {
      try {
        const data = await apiRequest("/auth/login", { method: "POST", body: { email, password } });
        localStorage.setItem("gf_token", data.token);
        setToken(data.token);
        setUser({ ...data.user, name: [data.user.firstName, data.user.lastName].filter(Boolean).join(" ") });
        return data.user.role;
      } catch (error) { return error.message; }
    },
    register: async ({ name, email, password }) => {
      const parts = name.trim().split(/\s+/);
      const firstName = parts.shift() || "";
      const lastName = parts.join(" ") || firstName;
      try {
        const data = await apiRequest("/auth/register", { method: "POST", body: { firstName, lastName, email, password } });
        localStorage.setItem("gf_token", data.token);
        setToken(data.token);
        setUser({ ...data.user, name: [data.user.firstName, data.user.lastName].filter(Boolean).join(" ") });
        return data.user.role;
      } catch (error) { return error.message; }
    },
    logout: () => {
      localStorage.removeItem("gf_token");
      setToken(null); setUser(null); setBookings([]); setDraft(null);
    },
  };

  const booking = {
    bookings, bookingsLoading, bookingError, refreshBookings, draft, setDraft,
    cancel: async (id) => {
      const selected = bookings.find((item) => item.id === id);
      if (!selected) throw new Error("Booking not found");
      await apiRequest(`/bookings/${selected.bookingId}/cancel`, { method: "POST", token });
      await refreshBookings();
    },
    update: async (id, changes) => {
      const selected = bookings.find((item) => item.id === id);
      if (!selected) throw new Error("Booking not found");
      await apiRequest(`/bookings/${selected.bookingId}/accessibility`, {
        method: "PATCH", body: { accessibilityNotes: changes.accessibilityNotes }, token,
      });
      await refreshBookings();
    },
    create: async ({ flightId, seatId, accessibilityNotes, paymentDetails }) => {
      const data = await apiRequest("/bookings", {
        method: "POST", token,
        body: { flightId, seatId, accessibilityNotes, paymentDetails },
      });
      await refreshBookings();
      return mapApiBooking(data.booking);
    },
  };

  if (authLoading) return <div className="auth-page"><p className="muted">Checking your session…</p></div>;
  return <AppContext.Provider value={{ auth, booking }}><Shell /></AppContext.Provider>;
}

const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

function Shell() {
  const { auth } = useApp();
  const nav = useNavigate();
  const staff = auth.user?.role === "Staff";
  return <div className="app">
    <header className="navbar">
      <Link className="brand" to="/">✦ GoldenFlights</Link>
      <nav>
        <NavLink to="/">Explore</NavLink>
        {auth.user && (staff ? <NavLink to="/staff">Staff dashboard</NavLink> : <NavLink to="/my-bookings">My bookings</NavLink>)}
        {auth.user ? <><span className="greeting">{staff ? "Staff view · " : "Hi, "}{auth.user.name.split(" ")[0]}</span><button className="btn small outline" onClick={() => { auth.logout(); nav("/"); }}>Log out</button></> : <><NavLink to="/login">Login</NavLink><Link className="btn small" to="/register">Create account</Link></>}
      </nav>
    </header>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/search" element={<Guard><Search /></Guard>} />
      <Route path="/results" element={<Guard><Results /></Guard>} />
      <Route path="/seats" element={<Guard><Seats /></Guard>} />
      <Route path="/passenger" element={<Guard><Passenger /></Guard>} />
      <Route path="/review" element={<Guard><Review /></Guard>} />
      <Route path="/confirmed" element={<Guard><Confirmed /></Guard>} />
      <Route path="/my-bookings" element={<Guard><PassengerGuard><MyBookings /></PassengerGuard></Guard>} />
      <Route path="/staff" element={<Guard><StaffGuard><StaffDashboard /></StaffGuard></Guard>} />
      <Route path="*" element={<Empty title="Page not found"><Link className="btn" to="/">Go home</Link></Empty>} />
    </Routes>
    <footer>© {new Date().getFullYear()} GoldenFlights · Airline reservation portal</footer>
  </div>;
}

function Guard({ children }) {
  const { auth } = useApp(); const loc = useLocation();
  return auth.user ? children : <Navigate to="/login" replace state={{ from: loc.pathname }} />;
}
function StaffGuard({ children }) { const { auth } = useApp(); return auth.user?.role === "Staff" ? children : <Navigate to="/my-bookings" replace />; }
function PassengerGuard({ children }) { const { auth } = useApp(); return auth.user?.role === "Staff" ? <Navigate to="/staff" replace /> : children; }

function Home() {
  return <main><section className="hero"><div className="hero-copy"><span className="eyebrow">YOUR NEXT ADVENTURE AWAITS</span><h1>The world is closer than <em>you think.</em></h1><p>Find your next destination, compare flights, and make every journey memorable.</p><Link className="btn large" to="/search">Explore flights →</Link></div><div className="hero-art"><div className="sun" /><div className="plane">✈</div><div className="art-label">GO BEYOND<br /><b>THE ORDINARY</b></div></div></section><section className="features"><div><b>✦ Thoughtful journeys</b><span>Find a flight that fits your plans.</span></div><div><b>◎ Simple booking</b><span>Choose your seats with ease.</span></div><div><b>♡ Your trips, together</b><span>Keep your bookings in one place.</span></div></section></main>;
}

function AuthPage({ mode }) {
  const { auth } = useApp(); const nav = useNavigate(); const loc = useLocation(); const reg = mode === "register";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError("");
    if (reg && form.password.length < 8) { setError("Use at least 8 characters for your password."); return; }
    setSubmitting(true); const result = reg ? await auth.register(form) : await auth.login(form); setSubmitting(false);
    if (result !== "Passenger" && result !== "Staff") setError(result);
    else nav(reg ? "/search" : (loc.state?.from || (result === "Staff" ? "/staff" : "/search")), { replace: true });
  }
  return <main className="auth-page"><section className="auth-card"><span className="eyebrow">✦ GOLDENFLIGHTS</span><h1>{reg ? "Create your account" : "Welcome back"}</h1><p className="muted">{reg ? "A world of possibilities starts here" : "Sign in with your GoldenFlights account"}</p><form className="form" onSubmit={submit}>{reg && <Field label="Full name" value={form.name} set={(v) => setForm({ ...form, name: v })} />}<Field label="Email address" type="email" value={form.email} set={(v) => setForm({ ...form, email: v })} /><Field label="Password" type="password" value={form.password} set={(v) => setForm({ ...form, password: v })} />{error && <p className="error">{error}</p>}<button className="btn full" disabled={submitting}>{submitting ? "Please wait…" : reg ? "Create account" : "Log in"}</button><p className="note">Staff members use their existing staff account. Your dashboard is selected automatically based on your account role.</p><p className="form-foot">{reg ? "Already registered?" : "New to GoldenFlights?"} <Link to={reg ? "/login" : "/register"}>{reg ? "Log in" : "Create an account"}</Link></p></form></section></main>;
}

function Field({ label, type = "text", value, set, ...props }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} onChange={(event) => set(event.target.value)} required {...props} /></label>;
}
function FieldSelect({ label, value, set }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event) => set(event.target.value)}>{airports.map((airport) => <option key={airport.code} value={airport.city}>{airport.city} ({airport.code})</option>)}</select></label>;
}
function Heading({ eyebrow, title, text }) { return <div className="heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>; }
function Progress({ step }) { return <div className="progress">{["Flight", "Seats", "Passenger", "Review"].map((name, index) => <div className={index <= step ? "active" : ""} key={name}><span>{index + 1}</span><small>{name}</small></div>)}</div>; }
function Empty({ title, children }) { return <main className="empty"><h2>{title}</h2>{children}</main>; }

function Search() {
  const { booking } = useApp(); const nav = useNavigate();
  const [form, setForm] = useState({ from: "Toronto", to: "Vancouver", date: defaultFlightDate() }); const [error, setError] = useState("");
  function submit(event) {
    event.preventDefault(); setError("");
    if (form.from === form.to) { setError("Choose two different destinations."); return; }
    booking.setDraft({ search: form, flight: null, seats: [], passenger: { accessibilityNotes: "" } });
    nav("/results");
  }
  return <main className="page"><Heading eyebrow="LET'S GET YOU THERE" title="Where to next?" text="Search the live flights stored in the GoldenFlights database." /><form className="search-panel" onSubmit={submit}><FieldSelect label="From" value={form.from} set={(v) => setForm({ ...form, from: v })} /><button type="button" className="swap" onClick={() => setForm({ ...form, from: form.to, to: form.from })}>⇄</button><FieldSelect label="To" value={form.to} set={(v) => setForm({ ...form, to: v })} /><label className="field"><span>Departure date</span><input type="date" min={today()} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label><div className="field"><span>Passengers</span><div className="static-field">1 passenger</div></div><button className="btn full search-submit">Search flights →</button>{error && <p className="error">{error}</p>}</form><p className="note">Live database search · One passenger per booking · Prices shown in CAD</p></main>;
}

function Results() {
  const { booking } = useApp(); const nav = useNavigate(); const draft = booking.draft;
  const [flights, setFlights] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!draft?.search) { setLoading(false); return undefined; }
    const params = new URLSearchParams({ departureCity: draft.search.from, arrivalCity: draft.search.to, date: draft.search.date, sort: "departure" });
    setLoading(true); setError("");
    apiRequest(`/flights?${params.toString()}`).then((data) => { if (active) setFlights((data.flights || []).map(mapApiFlight)); })
      .catch((err) => { if (active) { setFlights([]); setError(err.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [draft?.search?.from, draft?.search?.to, draft?.search?.date]);
  if (!draft?.search) return <Empty title="Start with a flight search"><Link className="btn" to="/search">Search flights</Link></Empty>;
  return <main className="page"><Heading eyebrow="YOUR OPTIONS" title="Available flights" text={`${draft.search.from} → ${draft.search.to} · ${draft.search.date}`} />{error && <p className="error">{error}</p>}{loading ? <p className="muted">Searching available flights…</p> : flights.length ? <div className="list">{flights.map((flight) => <article className="flight-card" key={flight.id}><div className="mark">✦</div><div className="flight-info"><span className="muted">{flight.airline} · {flight.flightNumber}</span><div className="flight-route"><div><b>{flight.departure}</b><small>{flight.from}</small></div><div className="duration"><small>{flight.duration}</small><i /><small>Non-stop</small></div><div><b>{flight.arrival}</b><small>{flight.to}</small></div></div><small className="muted">{flight.availableSeats} seats available</small></div><div className="price"><b>${flight.price.toFixed(2)}</b><small>CAD / person</small><button className="btn" disabled={flight.availableSeats < 1} onClick={() => { booking.setDraft({ ...draft, flight, seats: [], passenger: { accessibilityNotes: "" } }); nav("/seats"); }}>Select</button></div></article>)}</div> : <Empty title="No flights found"><p>No scheduled flights match those cities and date in the database.</p><Link className="btn" to="/search">Change search</Link></Empty>}</main>;
}

function Seats() {
  const { booking } = useApp(); const nav = useNavigate(); const draft = booking.draft;
  const [seats, setSeats] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!draft?.flight?.id) { setLoading(false); return undefined; }
    setLoading(true); setError("");
    apiRequest(`/flights/${draft.flight.id}/seats`).then((data) => { if (active) setSeats(data.seats || []); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [draft?.flight?.id]);
  if (!draft?.flight) return <Empty title="Select a flight first"><Link className="btn" to="/search">Search flights</Link></Empty>;
  const rows = [...new Set(seats.map((seat) => seat.seatNumber.match(/^\d+/)?.[0]).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  function toggle(seat) {
    const selected = draft.seats || [];
    booking.setDraft({ ...draft, seats: selected.some((item) => item.seatId === seat.seatId) ? [] : [{ seatId: seat.seatId, seatNumber: seat.seatNumber }] });
  }
  const chosen = draft.seats?.[0];
  return <main className="page"><Progress step={1} /><Heading eyebrow="MAKE IT YOURS" title="Choose your seat" text={`Select one available seat for ${draft.flight.from} → ${draft.flight.to}.`} />{error && <p className="error">{error}</p>}<div className="seat-layout"><section className="panel"><div className="legend"><span>🟩 Available</span><span>🟦 Selected</span><span>⬜ Unavailable</span></div>{loading ? <p className="muted">Loading seat map…</p> : <div className="seatmap">{rows.map((row) => <div className="seatrow" key={row}><small>{row}</small>{[...new Set(seats.filter((seat) => seat.seatNumber.match(/^\d+/)?.[0] === row).map((seat) => seat.seatNumber.slice(String(row).length)))].sort().map((letter, index) => { const seat = seats.find((item) => item.seatNumber === `${row}${letter}`); const selected = chosen?.seatId === seat.seatId; return <button type="button" key={seat.seatId} disabled={!seat.available} className={`seat ${!seat.available ? "occupied" : selected ? "chosen" : ""} ${index === 3 ? "aisle" : ""}`} onClick={() => toggle(seat)} title={`${seat.seatNumber} · ${seat.seatClass}`}>{letter}</button>; })}</div>)}</div>}</section><aside className="panel"><h3>Your selection</h3><p>{chosen?.seatNumber || "No seat selected yet"}</p><p className="muted">{chosen ? `${chosen.seatClass} · $${Number(chosen.seatFee).toFixed(2)} seat fee` : "Choose one seat to continue."}</p><button className="btn full" disabled={!chosen || loading} onClick={() => nav("/passenger")}>Continue</button><button className="text-btn" onClick={() => nav("/results")}>← Back to flights</button></aside></div></main>;
}

function Passenger() {
  const { auth, booking } = useApp(); const nav = useNavigate(); const draft = booking.draft;
  const [notes, setNotes] = useState(draft?.passenger?.accessibilityNotes || "");
  if (!draft?.flight || !draft.seats?.length) return <Empty title="Complete your flight and seat selection first"><Link className="btn" to="/search">Start again</Link></Empty>;
  function submit(event) { event.preventDefault(); booking.setDraft({ ...draft, passenger: { accessibilityNotes: notes } }); nav("/review"); }
  return <main className="page narrow"><Progress step={2} /><Heading eyebrow="ALMOST THERE" title="Passenger details" text="Confirm the passenger account used for this booking." /><form className="panel form" onSubmit={submit}><div className="account-summary"><b>{auth.user.name}</b><span>{auth.user.email}</span></div><label className="field"><span>Accessibility notes <small className="optional">(optional)</small></span><textarea rows="4" maxLength="1000" placeholder="Share any assistance or accessibility arrangements you'd like our team to know about." value={notes} onChange={(event) => setNotes(event.target.value)} /><small className="helper">These notes will be saved with your booking and shown to authorized staff. Only include details relevant to your travel arrangements.</small></label><button className="btn full">Continue to review</button></form></main>;
}

function detectCardBrand(digits) {
  if (/^4/.test(digits)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "American Express";
  if (/^6(?:011|5)/.test(digits)) return "Discover";
  return "Other";
}

function Review() {
  const { booking } = useApp(); const nav = useNavigate(); const draft = booking.draft;
  const [quote, setQuote] = useState(null); const [quoteError, setQuoteError] = useState("");
  const [card, setCard] = useState({ name: "", number: "", expiry: "", cvv: "" });
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");
  const selectedSeat = draft?.seats?.[0];
  useEffect(() => {
    let active = true;
    if (!draft?.flight?.id || !selectedSeat?.seatId) return undefined;
    apiRequest(`/flights/${draft.flight.id}/quote?seatId=${selectedSeat.seatId}`)
      .then((data) => { if (active) setQuote(data); })
      .catch((err) => { if (active) setQuoteError(err.message); });
    return () => { active = false; };
  }, [draft?.flight?.id, selectedSeat?.seatId]);
  if (!draft?.flight || !draft?.passenger || !selectedSeat) return <Empty title="Your booking details are incomplete"><Link className="btn" to="/search">Start a booking</Link></Empty>;

  async function submit(event) {
    event.preventDefault(); setError(""); setSubmitting(true);
    const digits = card.number.replace(/\D/g, "");
    try {
      const created = await booking.create({
        flightId: draft.flight.id,
        seatId: selectedSeat.seatId,
        accessibilityNotes: draft.passenger.accessibilityNotes || "",
        // Only non-sensitive display metadata is sent. Full PAN, expiry and CVV stay in this form.
        paymentDetails: {
          cardholderName: card.name.trim(),
          cardBrand: detectCardBrand(digits),
          cardLastFour: digits.slice(-4),
        },
      });
      booking.setDraft(null);
      nav("/confirmed", { replace: true, state: { booking: created } });
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  return <main className="page narrow"><Progress step={3} /><Heading eyebrow="FINAL CHECK" title="Review and confirm" text="Review your itinerary and enter fictional card details to complete the demo booking." />
    <section className="panel review"><h3>Flight</h3><div className="review-route"><b>{draft.flight.from}</b> → <b>{draft.flight.to}</b></div><p>{draft.flight.airline} · {draft.flight.flightNumber} · {draft.flight.departure}–{draft.flight.arrival}</p><p>{draft.flight.date} · 1 passenger</p><hr /><h3>Passenger</h3><p>Seat: {selectedSeat.seatNumber}</p>{draft.passenger.accessibilityNotes && <><hr /><h3>Accessibility notes</h3><p>{draft.passenger.accessibilityNotes}</p></>}
      <hr /><h3>Price breakdown</h3>{quoteError && <p className="error">{quoteError}</p>}{quote ? <>{quote.charges.map((charge) => <div className="charge-row" key={charge.chargeType}><span>{charge.description}</span><b>${Number(charge.amount).toFixed(2)}</b></div>)}<div className="total"><span>Total (CAD)</span><b>${Number(quote.total).toFixed(2)}</b></div></> : <p className="muted">Calculating total…</p>}
    </section>
    <form className="panel form payment-form" onSubmit={submit}>
      <div><span className="eyebrow">DEMO CHECKOUT</span><h2>Card details</h2><p className="payment-warning">Simulation only — no payment is processed. Use fictional test details only. The full card number, expiry date and security code are not sent to the server or stored.</p></div>
      <Field label="Name on card" value={card.name} set={(v) => setCard({ ...card, name: v })} autoComplete="cc-name" maxLength={120} />
      <label className="field"><span>Card number</span><input value={card.number} onChange={(event) => setCard({ ...card, number: event.target.value.replace(/[^\d ]/g, "").slice(0, 23) })} inputMode="numeric" autoComplete="cc-number" placeholder="Enter fictional card number" minLength={12} maxLength={23} pattern="[0-9 ]{12,23}" required /></label>
      <div className="two-col"><label className="field"><span>Expiry (MM/YY)</span><input value={card.expiry} onChange={(event) => setCard({ ...card, expiry: event.target.value.slice(0, 5) })} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" pattern="[0-9]{2}/[0-9]{2}" required /></label><label className="field"><span>Security code</span><input type="password" value={card.cvv} onChange={(event) => setCard({ ...card, cvv: event.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" autoComplete="cc-csc" placeholder="CVV" minLength={3} maxLength={4} pattern="[0-9]{3,4}" required /></label></div>
      {error && <p className="error">{error}</p>}
      <button className="btn full" disabled={submitting || !quote}>{submitting ? "Saving booking…" : `Confirm demo booking${quote ? ` · $${Number(quote.total).toFixed(2)}` : ""}`}</button>
      <p className="note">This is a mock checkout for a project demonstration. The backend records a simulated payment status and receipt only.</p>
    </form>
  </main>;
}

function Confirmed() {
  const loc = useLocation(); const created = loc.state?.booking;
  return <main className="auth-page"><section className="auth-card center"><div className="success">✓</div><span className="eyebrow">YOU'RE ALL SET</span><h1>Booking confirmed!</h1><p className="muted">Your booking and simulated payment record have been saved to the GoldenFlights database.</p>{created && <><h2 className="confirmed-total">${Number(created.total).toFixed(2)} CAD</h2><p className="confirmation-reference">Booking reference: <b>{created.id}</b></p>{created.payment?.receiptNumber && <p className="confirmation-reference">Demo receipt: <b>{created.payment.receiptNumber}</b></p>}</>}<p className="payment-warning">DEMO PAYMENT ONLY · No money was charged.</p><Link className="btn full" to="/my-bookings">View my bookings</Link><Link className="text-btn" to="/search">Book another flight</Link></section></main>;
}

function MyBookings() {
  const { booking } = useApp(); const [editing, setEditing] = useState(null); const [actionError, setActionError] = useState(""); const mine = booking.bookings;
  async function cancel(id) { if (!window.confirm("Cancel this booking? This action cannot be undone.")) return; try { setActionError(""); await booking.cancel(id); } catch (error) { setActionError(error.message); } }
  return <main className="page"><div className="heading-action"><Heading eyebrow="YOUR TRAVEL JOURNAL" title="My bookings" text="View your trips, update accessibility notes or cancel a booking." /><Link className="btn" to="/search">+ Find a flight</Link></div>{actionError && <p className="error">{actionError}</p>}{booking.bookingError && <p className="error">{booking.bookingError}</p>}{booking.bookingsLoading ? <p className="muted">Loading your bookings…</p> : mine.length ? <div className="list">{mine.map((item) => <BookingCard key={item.id} booking={item} onEdit={() => setEditing(item)} onCancel={() => cancel(item.id)} />)}</div> : <Empty title="No bookings yet"><p>Your database bookings will appear here.</p><Link className="btn" to="/search">Find a flight</Link></Empty>}{editing && <EditBookingModal booking={editing} onClose={() => setEditing(null)} onSave={async (changes) => { try { setActionError(""); await booking.update(editing.id, changes); setEditing(null); } catch (error) { setActionError(error.message); } }} />}</main>;
}

function BookingCard({ booking: item, onEdit, onCancel, staff = false }) {
  return <article className="panel booking"><div className="booking-top"><small>BOOKING {item.id}</small><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></div><div className="booking-route"><div><b>{item.flight.from}</b><small>{item.flight.departure}</small></div><span>✈</span><div><b>{item.flight.to}</b><small>{item.flight.arrival}</small></div></div><div className="booking-meta"><span>{item.search.date}</span><span>{item.flight.airline}</span><span>Flight: {item.flight.flightNumber}</span><span>Seat: {item.seats.length ? item.seats.join(", ") : "Not assigned"}</span><b>${Number(item.total).toFixed(2)} CAD</b></div>{staff && <div className="staff-passenger"><b>{item.passenger?.firstName} {item.passenger?.lastName}</b><span>{item.passenger?.email}</span></div>}{item.payment && <div className="payment-record"><b>Simulated payment · {item.payment.status}</b><span>{item.payment.cardholderName ? `${item.payment.cardholderName} · ` : ""}{item.payment.cardBrand || "Card"} ending {item.payment.cardLastFour || "••••"} · {item.payment.paymentMode || "MOCK"}</span>{item.payment.receiptNumber && <small>Receipt {item.payment.receiptNumber}</small>}</div>}{item.accessibilityNotes && <div className="accessibility-note"><b>♿ Accessibility notes</b><p>{item.accessibilityNotes}</p></div>}{!staff && item.status !== "Cancelled" && <div className="booking-actions"><button className="btn small outline" onClick={onEdit}>Update accessibility notes</button><button className="btn danger small" onClick={onCancel}>Cancel booking</button></div>}</article>;
}

function EditBookingModal({ booking: item, onClose, onSave }) {
  const [notes, setNotes] = useState(item.accessibilityNotes || ""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit() { setSaving(true); setError(""); try { await onSave({ accessibilityNotes: notes }); } catch (err) { setError(err.message); } finally { setSaving(false); } }
  return <div className="modal-backdrop" role="presentation"><section className="modal panel" role="dialog" aria-modal="true" aria-labelledby="edit-booking-title"><button className="modal-close" onClick={onClose} aria-label="Close">×</button><span className="eyebrow">BOOKING {item.id}</span><h2 id="edit-booking-title">Update booking details</h2><p className="muted">Update your accessibility or assistance notes. To change your flight, cancel this booking and make a new booking.</p><label className="field"><span>Accessibility notes</span><textarea rows="4" maxLength="1000" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Any assistance or accessibility arrangements?" /></label>{error && <p className="error">{error}</p>}<div className="modal-actions"><button className="btn outline" onClick={onClose}>Close</button><button className="btn" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div></section></div>;
}

function StaffDashboard() {
  const { booking } = useApp(); const [filter, setFilter] = useState("All"); const [query, setQuery] = useState(""); const [refreshing, setRefreshing] = useState(false); const all = booking.bookings;
  const visible = all.filter((item) => (filter === "All" || item.status === filter) && (`${item.id} ${item.passenger?.firstName || ""} ${item.passenger?.lastName || ""} ${item.passenger?.email || ""}`).toLowerCase().includes(query.toLowerCase()));
  const active = all.filter((item) => item.status !== "Cancelled").length;
  async function refresh() { setRefreshing(true); await booking.refreshBookings(); setRefreshing(false); }
  return <main className="page"><div className="heading-action"><Heading eyebrow="GOLDENFLIGHTS OPERATIONS" title="Staff dashboard" text="Review passenger bookings, payment records and accessibility requirements." /><button className="btn outline" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh bookings"}</button></div><div className="staff-stats"><div className="panel"><span>Total bookings</span><b>{all.length}</b></div><div className="panel"><span>Active bookings</span><b>{active}</b></div><div className="panel"><span>Cancelled</span><b>{all.length - active}</b></div></div><section className="panel staff-tools"><label className="field"><span>Search bookings</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Booking ID, passenger name or email" /></label><label className="field"><span>Booking status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All</option><option>Confirmed</option><option>Changed</option><option>Cancelled</option></select></label></section>{booking.bookingError && <p className="error">{booking.bookingError}</p>}<div className="staff-results-head"><h2>Passenger bookings</h2><span>{visible.length} result(s)</span></div>{booking.bookingsLoading ? <p className="muted">Loading passenger bookings…</p> : visible.length ? <div className="list">{visible.map((item) => <BookingCard key={item.id} booking={item} staff />)}</div> : <Empty title="No matching bookings"><p>Try another search or status filter.</p></Empty>}<p className="note">Booking, payment metadata and accessibility notes are loaded from the database. Full card numbers and security codes are never stored.</p></main>;
}

export default App;
