import { Gif } from '../types';

// This is a mock service to simulate fetching GIFs from an API like Giphy.
// It avoids needing a real API key for this example project.

const MOCK_GIF_RESULTS: Record<string, Gif[]> = {
    'default': [
        { id: 'l46CimS42vmmA3T1e', url: 'https://media3.giphy.com/media/l46CimS42vmmA3T1e/giphy.gif', previewUrl: 'https://media3.giphy.com/media/l46CimS42vmmA3T1e/200w_d.gif', title: 'Happy Dance GIF', dims: [480, 270] },
        { id: '3o7abB2g3V7gC6Xn3O', url: 'https://media2.giphy.com/media/3o7abB2g3V7gC6Xn3O/giphy.gif', previewUrl: 'https://media2.giphy.com/media/3o7abB2g3V7gC6Xn3O/200w_d.gif', title: 'Thumbs Up GIF', dims: [480, 270] },
        { id: '3o6Zt481isNVuQI1l6', url: 'https://media0.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif', previewUrl: 'https://media0.giphy.com/media/3o6Zt481isNVuQI1l6/200w_d.gif', title: 'Confused GIF', dims: [480, 270] },
        { id: 'l3q2K5jinAlChoCLS', url: 'https://media1.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif', previewUrl: 'https://media1.giphy.com/media/l3q2K5jinAlChoCLS/200w_d.gif', title: 'Whatever GIF', dims: [480, 270] },
    ],
    'happy': [
        { id: '5GoVLqeAOo6PK', url: 'https://media1.giphy.com/media/5GoVLqeAOo6PK/giphy.gif', previewUrl: 'https://media1.giphy.com/media/5GoVLqeAOo6PK/200w_d.gif', title: 'Happy Minions GIF', dims: [320, 180] },
        { id: 'xT5LMHxhOfscxPfIfm', url: 'https://media4.giphy.com/media/xT5LMHxhOfscxPfIfm/giphy.gif', previewUrl: 'https://media4.giphy.com/media/xT5LMHxhOfscxPfIfm/200w_d.gif', title: 'Happy Spongebob GIF', dims: [480, 360] },
    ],
    'sad': [
        { id: '3o6wreo44azjQtfhM4', url: 'https://media2.giphy.com/media/3o6wreo44azjQtfhM4/giphy.gif', previewUrl: 'https://media2.giphy.com/media/3o6wreo44azjQtfhM4/200w_d.gif', title: 'Sad Crying GIF', dims: [480, 360] },
        { id: 'OPU6wIsG8q3oA', url: 'https://media3.giphy.com/media/OPU6wIsG8q3oA/giphy.gif', previewUrl: 'https://media3.giphy.com/media/OPU6wIsG8q3oA/200w_d.gif', title: 'Sad Cat GIF', dims: [480, 319] },
    ],
    'congrats': [
        { id: 'a0h7sAqON67nO', url: 'https://media0.giphy.com/media/a0h7sAqON67nO/giphy.gif', previewUrl: 'https://media0.giphy.com/media/a0h7sAqON67nO/200w_d.gif', title: 'Congratulations GIF', dims: [500, 269] },
    ],
};

export const searchGifs = async (query: string): Promise<Gif[]> => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));

    const lowerCaseQuery = query.toLowerCase();
    for (const key in MOCK_GIF_RESULTS) {
        if (lowerCaseQuery.includes(key)) {
            return MOCK_GIF_RESULTS[key];
        }
    }
    return MOCK_GIF_RESULTS.default;
};

export const getTrendingGifs = async (): Promise<Gif[]> => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));
    return MOCK_GIF_RESULTS.default;
};
