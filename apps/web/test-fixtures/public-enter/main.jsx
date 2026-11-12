import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import EventConfigContext from '../../src/contexts/EventConfigContext.jsx';
import AccountMenu from '../../src/components/AccountMenu.jsx';
import CalendarMenu from '../../src/components/session/CalendarMenu.jsx';
import CallingPoints from '../../src/components/CallingPoints.jsx';
import FaqItemBlock from '../../src/components/blocks/FaqItemBlock.jsx';
import { StepList } from '../../src/components/forms/Stepper.jsx';
import '@generated/theme.css';
import '../../src/index.css';

const eventConfig = { name: 'Component fixture', timezone: 'UTC', days: [{ id: 'one', date: '2026-11-12' }] };
const parent = { id: 'parent', title: 'Parent session', dayId: 'one', startTime: '09:00', endTime: '10:00', visible: true };
const child = { ...parent, id: 'child', title: 'Calling point', startTime: '09:15', endTime: '09:30' };
const views = [{ id: 'attendee', label: 'Attendee', to: '/reader' }, { id: 'speaker', label: 'Speaker', to: '/speaker' }];
const account = { views, current: views[0], select() {} };
const steps = [{ slug: 'first', title: 'First', state: 'todo' }, { slug: 'review', title: 'Review', state: 'todo' }];

createRoot(document.getElementById('root')).render(
  <MemoryRouter>
    <EventConfigContext.Provider value={{ eventConfig }}>
      <main>
        <h1>Public enter component fixture</h1>
        <section id="account"><AccountMenu account={account} /></section>
        <section id="calendar"><CalendarMenu eventConfig={eventConfig} session={parent} /></section>
        <section id="calling"><CallingPoints parent={parent} points={[child]} eventConfig={eventConfig} /></section>
        <section id="faq"><FaqItemBlock block={{ question: 'A question', answer: '<p><a href="#answer">Answer link</a></p>' }} /></section>
        <section id="public-steps"><StepList steps={steps} current={0} hrefFor={(step) => `/${step.slug}`} wide={false} /></section>
        <section id="admin-steps"><StepList steps={steps} current={0} hrefFor={(step) => `/${step.slug}`} wide={false} tier="admin" /></section>
      </main>
    </EventConfigContext.Provider>
  </MemoryRouter>,
);
