import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  HashRouter,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

let contentValue;
let configValue;

vi.mock('../../contexts/ContentContext.jsx', () => ({
  useContent: () => contentValue,
}));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => configValue,
}));

const { default: SpeakerResourceCard } = await import('./SpeakerResourceCard.jsx');

const GUIDELINES = {
  id: 'guidelines',
  label: 'Guidelines',
  path: '/guidelines',
  visible: true,
};
const TRAVEL = {
  id: 'travel',
  label: 'Travel',
  path: '/travel',
  visible: true,
  sections: [{ id: 'travel_map', label: 'Venue map' }],
};
const VENUE_MAP = {
  venue: {
    map: { image: 'cms-images/venue-map.png', alt: 'Venue floor plan', markers: [] },
  },
};

function publicPage(pages) {
  return (id) => pages.find((page) => page.id === id && page.visible === true) ?? null;
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}{location.hash}</output>;
}

function ResourceRoute() {
  return (
    <>
      <SpeakerResourceCard />
      <LocationProbe />
      <span id="section-travel_map" />
    </>
  );
}

beforeEach(() => {
  contentValue = { getPublicPage: publicPage([GUIDELINES, TRAVEL]) };
  configValue = {
    features: {},
    eventConfig: {
      ...VENUE_MAP,
      speakerResources: {
        slideTemplate: {
          label: 'Presentation template',
          url: 'https://SLIDES.example.org/template',
        },
      },
    },
  };
  window.history.replaceState(null, '', '/');
});

describe('SpeakerResourceCard', () => {
  it('renders visible page, venue-map, and canonical slide links with native focus access', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SpeakerResourceCard />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Speaker resources' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Guidelines' })).toHaveAttribute('href', '/guidelines');
    expect(screen.getByRole('link', { name: 'Travel' })).toHaveAttribute('href', '/travel');
    expect(screen.getByRole('link', { name: 'Venue map' })).toHaveAttribute(
      'href',
      '/travel#section-travel_map',
    );
    expect(screen.getByRole('link', { name: /Presentation template/ })).toHaveAttribute(
      'href',
      'https://slides.example.org/template',
    );

    const links = screen.getAllByRole('link');
    for (const link of links) expect(link.tabIndex).toBe(0);
    links[0].focus();
    expect(links[0]).toHaveFocus();
  });

  it('omits missing, hidden, malformed, and unsafe resources, including an empty card', () => {
    contentValue = {
      getPublicPage: publicPage([
        { ...GUIDELINES, visible: false },
        { ...TRAVEL, path: '//example.org/travel', sections: [] },
      ]),
    };
    configValue = {
      features: {},
      eventConfig: {
        ...VENUE_MAP,
        speakerResources: {
          slideTemplate: { label: 'Presentation template', url: 'javascript:alert(1)' },
        },
      },
    };
    const { container } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SpeakerResourceCard />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('routes the venue map to the page anchor with normal routing', () => {
    render(
      <MemoryRouter
        initialEntries={['/speaker/dashboard']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="*" element={<ResourceRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Venue map' }));
    expect(screen.getByRole('status', { name: 'Current location' })).toHaveTextContent(
      '/travel#section-travel_map',
    );
    expect(document.getElementById('section-travel_map')).not.toBeNull();
  });

  it('links a configured map on a legacy travel page using its configured alt text', () => {
    contentValue = {
      getPublicPage: publicPage([{ ...TRAVEL, sections: [] }]),
    };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SpeakerResourceCard />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Venue floor plan' })).toHaveAttribute(
      'href',
      '/travel#section-travel_map',
    );
  });

  it('links the existing area map when no uploaded map is configured', () => {
    contentValue = {
      getPublicPage: publicPage([
        {
          ...TRAVEL,
          sections: [{ id: 'travel_local', label: 'Around the venue' }],
        },
      ]),
    };
    configValue = {
      features: {},
      eventConfig: {
        venue: {
          mapUrl: 'https://www.openstreetmap.org/?mlat=40.74&mlon=-74.17',
        },
      },
    };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SpeakerResourceCard />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Around the venue' })).toHaveAttribute(
      'href',
      '/travel#section-travel_local',
    );
  });

  it('omits an unsafe area-map URL', () => {
    contentValue = {
      getPublicPage: publicPage([
        {
          ...TRAVEL,
          sections: [{ id: 'travel_local', label: 'Around the venue' }],
        },
      ]),
    };
    configValue = {
      features: {},
      eventConfig: { venue: { mapUrl: 'https://example.org/map' } },
    };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SpeakerResourceCard />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'Around the venue' })).toBeNull();
  });

  it('routes the venue map to the page anchor with HashRouter', async () => {
    window.history.replaceState(null, '', '/#/speaker/dashboard');
    render(
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="*" element={<ResourceRoute />} />
        </Routes>
      </HashRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Venue map' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/travel#section-travel_map');
    });
    expect(screen.getByRole('status', { name: 'Current location' })).toHaveTextContent(
      '/travel#section-travel_map',
    );
  });
});
