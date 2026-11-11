/* The home-page example stays on this page; it never contacts an event site. */
(() => {
  const example = document.querySelector('[data-event-example]');
  if (!example) return;

  const dayButtons = [...example.querySelectorAll('[data-example-day]')];
  const days = [...example.querySelectorAll('[data-day]')];
  const sessions = [...example.querySelectorAll('[data-session]')];
  const savedFilter = example.querySelector('[data-saved-filter]');
  const count = example.querySelector('[data-save-count]');
  const feedback = example.querySelector('[data-example-feedback]');
  const empty = example.querySelector('[data-example-empty]');
  let currentDay = 'one';
  let savedOnly = false;

  const saved = (row) => row.querySelector('.save-session').getAttribute('aria-pressed') === 'true';
  const render = () => {
    const savedCount = sessions.filter(saved).length;
    count.textContent = String(savedCount);
    savedFilter.setAttribute('aria-pressed', String(savedOnly));
    savedFilter.setAttribute('aria-label', `My schedule, ${savedCount} saved sessions`);
    dayButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.exampleDay === currentDay && !savedOnly));
    });
    days.forEach((day) => {
      day.hidden = savedOnly ? ![...day.querySelectorAll('[data-session]')].some(saved) : day.dataset.day !== currentDay;
      day.querySelector('.example-day-label').hidden = !savedOnly;
    });
    sessions.forEach((row) => { row.hidden = savedOnly && !saved(row); });
    empty.hidden = !savedOnly || savedCount > 0;
  };

  dayButtons.forEach((button) => button.addEventListener('click', () => {
    currentDay = button.dataset.exampleDay;
    savedOnly = false;
    render();
    feedback.textContent = `${button.textContent} sessions. Save a session to add it to your plan.`;
  }));

  savedFilter.addEventListener('click', () => {
    savedOnly = !savedOnly;
    render();
    feedback.textContent = savedOnly ? 'Your saved sessions from both days.' : 'Browse the program and save a session.';
  });

  sessions.forEach((row) => {
    const button = row.querySelector('.save-session');
    const title = row.querySelector('h4').textContent;
    button.addEventListener('click', () => {
      const isSaved = !saved(row);
      button.setAttribute('aria-pressed', String(isSaved));
      // Keep focus reachable when a saved row leaves the visible list.
      if (savedOnly && !isSaved) savedFilter.focus();
      render();
      feedback.textContent = `${title} ${isSaved ? 'saved to' : 'removed from'} your example schedule.`;
    });
    button.hidden = false;
  });

  example.querySelector('.example-controls').hidden = false;
  feedback.textContent = 'A fictional event. Try saving a session.';
  example.classList.add('is-interactive');
  render();
})();
