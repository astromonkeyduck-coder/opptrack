export default function Home() {
  return (
    <main>
      <header>
        <a className="wordmark" href="/" aria-label="FSU Opportunity Tracker home">
          <span className="mark" aria-hidden="true">F</span>
          <span>Opportunity Tracker</span>
        </a>
        <span className="status">Setup in progress</span>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Make more of campus</p>
        <h1 id="page-title">Find your next<br />worthwhile thing.</h1>
        <p className="lead">
          Speakers, live music, films, clubs, outdoor trips, research, and
          unfamiliar opportunities worth exploring. A place to discover broadly
          and choose what deserves your time.
        </p>
      </section>

      <section className="setup" aria-labelledby="setup-title">
        <div className="setup-heading">
          <span className="dot" aria-hidden="true" />
          <h2 id="setup-title">Your review inbox is being prepared</h2>
        </div>
        <p>
          This is the initial application. Sign-in, the private opportunity
          inbox, and scheduled collection are not connected yet.
        </p>
        <p className="approval">
          You will approve each event or action reminder before it reaches your calendar.
        </p>
      </section>

      <footer>
        <span>Campus comes first.</span>
        <span>Discover broadly. Choose deliberately.</span>
      </footer>
    </main>
  );
}
