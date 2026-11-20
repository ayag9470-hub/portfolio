const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    featured: { type: Boolean, default: false },
    description: { type: String, required: true },
    image: { type: String, required: true },
    tech: [{ type: String }],
    liveUrl: { type: String, default: '#' },
    githubUrl: { type: String, default: 'https://github.com/' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', ProjectSchema);
