import { fetchConcept3dLocations } from './concept3d-client';

describe('fetchConcept3dLocations', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  function mockFetchOnce(
    impl: (url: string, init?: Parameters<typeof fetch>[1]) => Response | Promise<Response>,
  ) {
    const fn = jest.fn(impl) as unknown as typeof fetch;
    globalThis.fetch = fn;
    return fn as unknown as jest.Mock;
  }

  it('hits the documented endpoint with default map id and api key when env not set', async () => {
    delete process.env.CONCEPT3D_API_KEY;
    delete process.env.CONCEPT3D_MAP_ID;

    const fetchMock = mockFetchOnce(
      () => new Response(JSON.stringify([{ id: 1, name: 'X', catId: 100 }]), { status: 200 }),
    );

    const result = await fetchConcept3dLocations();

    expect(result).toEqual([{ id: 1, name: 'X', catId: 100 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('https://api.concept3d.com/locations');
    expect(url).toContain('map=1314');
    expect(url).toContain('key=0001085cc708b9cef47080f064612ca5');
  });

  it('honors CONCEPT3D_MAP_ID and CONCEPT3D_API_KEY env overrides', async () => {
    process.env.CONCEPT3D_MAP_ID = '9999';
    process.env.CONCEPT3D_API_KEY = 'env-key';
    const fetchMock = mockFetchOnce(() => new Response('[]', { status: 200 }));

    await fetchConcept3dLocations();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('map=9999');
    expect(url).toContain('key=env-key');
  });

  it('prefers explicit opts over env vars', async () => {
    process.env.CONCEPT3D_MAP_ID = '9999';
    process.env.CONCEPT3D_API_KEY = 'env-key';
    const fetchMock = mockFetchOnce(() => new Response('[]', { status: 200 }));

    await fetchConcept3dLocations({ mapId: 42, apiKey: 'opt-key' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('map=42');
    expect(url).toContain('key=opt-key');
  });

  it('url-encodes the api key', async () => {
    const fetchMock = mockFetchOnce(() => new Response('[]', { status: 200 }));

    await fetchConcept3dLocations({ apiKey: 'a b/c?&d' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('key=a%20b%2Fc%3F%26d');
  });

  it('forwards the AbortSignal to fetch', async () => {
    const fetchMock = mockFetchOnce(() => new Response('[]', { status: 200 }));
    const controller = new AbortController();

    await fetchConcept3dLocations({ signal: controller.signal });

    const init = fetchMock.mock.calls[0][1] as Parameters<typeof fetch>[1];
    expect(init?.signal).toBe(controller.signal);
    expect(init?.headers).toMatchObject({ Accept: 'application/json' });
  });

  it('throws with status code when the API returns non-2xx', async () => {
    mockFetchOnce(() => new Response('upstream down', { status: 503 }));

    await expect(fetchConcept3dLocations({ mapId: 7 })).rejects.toThrow(
      /concept3d \/locations returned HTTP 503 for map=7/,
    );
  });

  it('throws when the API returns a non-array body', async () => {
    mockFetchOnce(
      () => new Response(JSON.stringify({ error: 'nope' }), { status: 200 }),
    );

    await expect(fetchConcept3dLocations()).rejects.toThrow(
      /concept3d \/locations returned non-array body/,
    );
  });
});
